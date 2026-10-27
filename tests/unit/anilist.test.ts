import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { anilistDate, anilistRating, anilistStatus, mapAnilistMedia } from '../../apps/api/src/adapters/anilist.js';
import { resetImportsForTests } from '../../apps/api/src/services/imports.js';
import { sliceAt, spinPool, spinTarget } from '../../packages/shared/src/backlog.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };

const media = (id: number, english: string | null, romaji: string, extra: object = {}) => ({
  id,
  title: { english, romaji },
  format: 'TV',
  status: 'FINISHED',
  episodes: 12,
  duration: 24,
  seasonYear: 2011,
  startDate: { year: 2011 },
  genres: ['Drama'],
  description: 'A <i>story</i>.<br>',
  coverImage: { large: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${id}.png` },
  studios: { nodes: [{ name: 'Studio X' }] },
  nextAiringEpisode: null,
  ...extra,
});

describe('AniList export parsing', () => {
  it('maps the export’s numeric statuses, 0–100 scores and yyyymmdd dates', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(anilistStatus)).toEqual(['IN_PROGRESS', 'PLANNED', 'COMPLETED', 'DROPPED', 'PAUSED', 'COMPLETED', null]);
    expect([0, 100, 85, 80, 3].map(anilistRating)).toEqual([null, 10, 9, 8, 1]);
    expect(anilistDate(20210417)).toBe('2021-04-17T12:00:00.000Z');
    expect(anilistDate(0)).toBeNull();
    expect(anilistDate(20211399)).toBeNull();
  });

  it('prefers the English title, keeps romaji as the alternate, and counts only aired episodes', () => {
    expect(mapAnilistMedia(media(1, 'The Future Diary', 'Mirai Nikki') as any)).toMatchObject({
      title: 'The Future Diary',
      alt_title: 'Mirai Nikki',
      episodes: 12,
      synopsis: 'A story .',
      studio: 'Studio X',
    });
    expect(mapAnilistMedia(media(2, null, 'Gintama') as any)).toMatchObject({ title: 'Gintama', alt_title: null });
    expect(mapAnilistMedia(media(3, 'Airing', 'Airing', { status: 'RELEASING', episodes: 24, nextAiringEpisode: { episode: 8 } }) as any).episodes).toBe(7);
    expect(mapAnilistMedia(media(4, 'Soon', 'Soon', { status: 'NOT_YET_RELEASED' }) as any).episodes).toBe(0);
    expect(mapAnilistMedia(media(5, 'X', 'X', { coverImage: { large: 'https://evil.example/x.png' } }) as any).cover_url).toBeNull();
  });
});

describe('AniList import', () => {
  let app: ReturnType<typeof buildServer>;
  let requests: number[][];
  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers, payload });
    return { status: res.statusCode, body: res.json() as any };
  };
  const finish = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const j = (await call('GET', `/api/import/jobs/${id}`)).body;
      if (j.finished) return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job never finished');
  };
  const catalogue = new Map<number, object>([
    [10620, media(10620, 'The Future Diary', 'Mirai Nikki', { episodes: 26 })],
    [20447, media(20447, null, 'Ping Pong the Animation', { episodes: 11 })],
    [30000, media(30000, 'Airing Show', 'Airing Show', { status: 'RELEASING', episodes: null, nextAiringEpisode: { episode: 5 } })],
    [40000, media(40000, 'Mystery Count', 'Mystery Count', { episodes: null })],
  ]);
  const entry = (series_id: number, status: number, extra: object = {}) => ({
    series_id,
    status,
    score: 0,
    progress: 0,
    started_on: 0,
    finished_on: 0,
    ...extra,
  });

  beforeEach(() => {
    app = buildServer({ db: openDb(':memory:'), host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
    process.env.IMPORT_GAP_MS = '0';
    resetImportsForTests();
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        if (new URL(String(url)).hostname !== 'graphql.anilist.co') return new Response('not found', { status: 404 });
        const ids = JSON.parse(String(init?.body)).variables.ids as number[];
        requests.push(ids);
        return new Response(JSON.stringify({ data: { Page: { media: ids.map((i) => catalogue.get(i)).filter(Boolean) } } }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.IMPORT_GAP_MS;
  });

  it('previews without writing, then adds anime to TV with status, score, dates and episode progress', async () => {
    // Already in the Pit under its romaji name: flagged and left alone.
    await call('POST', '/api/library', { type: 'TV', title: 'Ping Pong the Animation', year: 2011 });

    const started = await call('POST', '/api/import/anilist/preview', {
      entries: [
        entry(10620, 0, { progress: 5, score: 80, started_on: 20210410 }),
        entry(20447, 2, { progress: 11, finished_on: 20220119 }),
        entry(30000, 2, { score: 100, started_on: 20260101, finished_on: 20260301 }),
        entry(40000, 4, { progress: 3 }),
        entry(99999, 1),
        entry(10620, 1), // duplicate row: the first one wins
      ],
    });
    expect(started.status).toBe(202);
    const preview = await finish(started.body.id);
    expect(preview.error).toBeNull();
    expect(requests).toEqual([[10620, 20447, 30000, 40000, 99999]]);
    expect(preview.notice).toMatch(/1 entry .* no longer exist/);
    const byKey = Object.fromEntries(preview.items.map((i: any) => [i.key, i]));
    expect(Object.keys(byKey).sort()).toEqual(['10620', '20447', '30000', '40000']);
    expect(byKey['10620']).toMatchObject({
      source: 'ANILIST',
      type: 'TV',
      title: 'The Future Diary',
      status: 'IN_PROGRESS',
      rating: 8,
      started_at: '2021-04-10T12:00:00.000Z',
      tv: { episodes: 26, watched: 5, alt_title: 'Mirai Nikki' },
      in_pit: null,
    });
    expect(byKey['20447'].in_pit).toBeTruthy();
    expect((await call('GET', '/api/library?type=TV')).body).toHaveLength(1);

    const imported = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(imported.result).toEqual({ added: 3, skipped: 1, failed: [] });
    const rows = (await call('GET', '/api/library?type=TV')).body as any[];
    const row = (t: string) => rows.find((r) => r.media.title === t);
    expect(row('The Future Diary').entry).toMatchObject({
      status: 'IN_PROGRESS',
      personal_rating: 8,
      started_at: '2021-04-10T12:00:00.000Z',
      completed_at: null,
    });
    expect(row('The Future Diary').media).toMatchObject({ metadata_source: 'ANILIST', source_url: 'https://anilist.co/anime/10620', runtime_min: 24 });
    expect(row('The Future Diary').tv).toEqual({ eligible: 26, watched: 5, seasons: 1 });
    // Airing: only the 4 aired episodes exist, all watched; completion date from the export.
    expect(row('Airing Show').entry).toMatchObject({ status: 'COMPLETED', personal_rating: 10, completed_at: '2026-03-01T12:00:00.000Z' });
    expect(row('Airing Show').tv).toEqual({ eligible: 4, watched: 4, seasons: 1 });
    // AniList doesn't know the count: the owner's progress is the only number, nothing is guessed beyond it.
    expect(row('Mystery Count').entry.status).toBe('PAUSED');
    expect(row('Mystery Count').tv).toEqual({ eligible: 3, watched: 3, seasons: 1 });

    const again = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(again.result).toEqual({ added: 0, skipped: 4, failed: [] });
  });

  it('rejects items whose source and type disagree, and an export with no anime', async () => {
    const preview = await finish((await call('POST', '/api/import/anilist/preview', { entries: [entry(10620, 1)] })).body.id);
    const bad = { ...preview.items[0], type: 'MOVIE' };
    expect((await call('POST', '/api/import', { items: [bad] })).status).toBe(400);
    expect((await call('POST', '/api/import', { items: [{ ...preview.items[0], tv: null }] })).status).toBe(400);
    expect((await call('POST', '/api/import/anilist/preview', { entries: [entry(10620, 42)] })).status).toBe(400);
  });
});

describe('spin wheel', () => {
  const row = (title: string, status: string, created: string, archived: string | null = null) =>
    ({ media: { title }, entry: { id: title, status, created_at: created, archived_at: archived } }) as any;

  it('spins only what is still waiting: Planned and Paused, not archived', () => {
    const rows = [
      row('b', 'PLANNED', '2026-02-01'),
      row('a', 'PAUSED', '2026-01-01'),
      row('now', 'IN_PROGRESS', '2026-01-01'),
      row('done', 'COMPLETED', '2026-01-01'),
      row('quit', 'DROPPED', '2026-01-01'),
      row('old', 'PLANNED', '2025-01-01', '2026-01-01'),
    ];
    expect(spinPool(rows).map((r) => r.media.title)).toEqual(['a', 'b']);
  });

  it('lands the chosen slice under the pointer after the requested turns', () => {
    for (const n of [1, 2, 7, 611]) {
      for (const index of [0, Math.floor(n / 2), n - 1]) {
        for (const offset of [0, 0.5, 0.999]) {
          const from = 1234.5;
          const to = spinTarget(from, index, n, 6, offset);
          expect(sliceAt(to, n)).toBe(index);
          expect(to - from).toBeGreaterThanOrEqual(6 * 360);
          expect(to - from).toBeLessThan(7 * 360);
        }
      }
    }
    expect(sliceAt(0, 4)).toBe(0);
    expect(sliceAt(-100, 4)).toBe(1);
  });
});
