import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { anilistDate, anilistRating, anilistStatus, mapAnilistMedia } from '../../apps/api/src/adapters/anilist.js';
import { mangaProgressNote, resetImportsForTests } from '../../apps/api/src/services/imports.js';
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
      creator: 'Studio X',
    });
    expect(mapAnilistMedia(media(2, null, 'Gintama') as any)).toMatchObject({ title: 'Gintama', alt_title: null });
    expect(mapAnilistMedia(media(3, 'Airing', 'Airing', { status: 'RELEASING', episodes: 24, nextAiringEpisode: { episode: 8 } }) as any).episodes).toBe(7);
    expect(mapAnilistMedia(media(4, 'Soon', 'Soon', { status: 'NOT_YET_RELEASED' }) as any).episodes).toBe(0);
    expect(mapAnilistMedia(media(5, 'X', 'X', { coverImage: { large: 'https://evil.example/x.png' } }) as any).cover_url).toBeNull();
  });

  it('credits a manga to its writer and keeps chapter progress as a note, never as pages', () => {
    const staff = (edges: [string, string][]) => ({ studios: undefined, staff: { edges: edges.map(([role, full]) => ({ role, node: { name: { full } } })) } });
    expect(
      mapAnilistMedia(
        media(
          6,
          'Monster',
          'Monster',
          staff([
            ['Story & Art', 'Naoki Urasawa'],
            ['Supervisor', 'Takashi Nagasaki'],
          ]),
        ) as any,
      ).creator,
    ).toBe('Naoki Urasawa');
    expect(
      mapAnilistMedia(
        media(
          7,
          'E21',
          'E21',
          staff([
            ['Assistant', 'A'],
            ['Story', 'Riichirou Inagaki'],
            ['Art', 'Yuusuke Murata'],
          ]),
        ) as any,
      ).creator,
    ).toBe('Riichirou Inagaki');
    expect(mapAnilistMedia(media(8, 'X', 'X', staff([['Translator', 'T']])) as any).creator).toBeNull();
    const m = (chapters_read: number, volumes_read: number, chapters: number | null = null, volumes: number | null = null) => ({
      format: 'MANGA',
      chapters,
      volumes,
      chapters_read,
      volumes_read,
      alt_title: null,
    });
    expect(mangaProgressNote('IN_PROGRESS', m(229, 0))).toBe('AniList progress: chapter 229');
    expect(mangaProgressNote('PAUSED', m(97, 11, 162, 18))).toBe('AniList progress: chapter 97/162, volume 11/18');
    expect(mangaProgressNote('COMPLETED', m(162, 18, 162, 18))).toBe('');
    expect(mangaProgressNote('PLANNED', m(0, 0))).toBe('');
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
  const manga = new Map<number, object>([
    [
      30002,
      media(30002, 'Berserk', 'Berserk', {
        format: 'MANGA',
        status: 'RELEASING',
        studios: undefined,
        staff: { edges: [{ role: 'Story & Art', node: { name: { full: 'Kentarou Miura' } } }] },
      }),
    ],
    [105778, media(105778, null, 'Chainsaw Man', { format: 'MANGA', chapters: 97, volumes: 11, studios: undefined })],
    [98361, media(98361, 'Three Days of Happiness', 'Jumyou wo Kaitottemoratta.', { format: 'NOVEL', studios: undefined })],
    [97553, media(97553, 'Three Days of Happiness', 'Jumyou wo Kaitotte Moratta.', { format: 'MANGA', studios: undefined })],
  ]);
  const entry = (series_id: number, status: number, extra: object = {}) => ({
    series_id,
    series_type: 0,
    status,
    score: 0,
    progress: 0,
    progress_volume: 0,
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
        const { query, variables } = JSON.parse(String(init?.body));
        const ids = variables.ids as number[];
        requests.push(ids);
        const from = /type: MANGA/.test(query) ? manga : catalogue;
        return new Response(JSON.stringify({ data: { Page: { media: ids.map((i) => from.get(i)).filter(Boolean) } } }));
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

  it('adds manga to Books with the writer, score, dates and chapter progress in the notes', async () => {
    const preview = await finish(
      (
        await call('POST', '/api/import/anilist/preview', {
          entries: [
            entry(10620, 2),
            entry(30002, 0, { series_type: 1, progress: 229, score: 90, started_on: 20240105 }),
            entry(105778, 2, { series_type: 1, progress: 97, progress_volume: 11, finished_on: 20230301 }),
          ],
        })
      ).body.id,
    );
    expect(preview.error).toBeNull();
    // Anime and manga are looked up separately (each asks for its own fields).
    expect(requests).toEqual([[10620], [30002, 105778]]);
    const byKey = Object.fromEntries(preview.items.map((i: any) => [i.key, i]));
    expect(Object.keys(byKey).sort()).toEqual(['10620', 'manga-105778', 'manga-30002']);
    expect(byKey['manga-30002']).toMatchObject({
      type: 'BOOK',
      title: 'Berserk',
      creator: 'Kentarou Miura',
      status: 'IN_PROGRESS',
      rating: 9,
      source_url: 'https://anilist.co/manga/30002',
      tv: null,
      manga: { chapters_read: 229, chapters: null },
    });

    const imported = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(imported.result).toEqual({ added: 3, skipped: 0, failed: [] });
    const books = (await call('GET', '/api/library?type=BOOK')).body as any[];
    const book = (t: string) => books.find((r) => r.media.title === t);
    expect(book('Berserk').entry).toMatchObject({
      status: 'IN_PROGRESS',
      personal_rating: 9,
      started_at: '2024-01-05T12:00:00.000Z',
      notes: 'AniList progress: chapter 229',
      current_page: null,
    });
    expect(book('Berserk').media).toMatchObject({ metadata_source: 'ANILIST', creator: 'Kentarou Miura', source_url: 'https://anilist.co/manga/30002' });
    expect(book('Berserk').pages).toBeNull();
    expect(book('Chainsaw Man').entry).toMatchObject({ status: 'COMPLETED', completed_at: '2023-03-01T12:00:00.000Z', notes: '' });
    expect((await call('GET', '/api/library?type=TV')).body).toHaveLength(1);

    const again = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(again.result).toEqual({ added: 0, skipped: 3, failed: [] });

    // Stats report the AniList share of each type, so the UI can leave anime/manga out of its totals.
    await call('POST', '/api/library', { type: 'BOOK', title: 'Dune' });
    const stats = (await call('GET', '/api/stats')).body;
    expect(stats.byType.BOOK).toEqual({ total: 3, completed: 1, in_progress: 1 });
    expect(stats.anilist.BOOK).toEqual({ total: 2, completed: 1, in_progress: 1 });
    expect(stats.anilist.TV).toEqual({ total: 1, completed: 1, in_progress: 0 });
    expect(stats.anilist.GAME).toEqual({ total: 0, completed: 0, in_progress: 0 });
  });

  it('adds two AniList works that share a title (a light novel and its manga) as separate books', async () => {
    const entries = [entry(98361, 1, { series_type: 1 }), entry(97553, 1, { series_type: 1 })];
    const preview = await finish((await call('POST', '/api/import/anilist/preview', { entries })).body.id);
    expect(preview.items.map((i: any) => i.in_pit)).toEqual([null, null]);
    const imported = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(imported.result).toEqual({ added: 2, skipped: 0, failed: [] });
    // Re-running adds nothing: each one is found by its own AniList ID.
    const again = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(again.result).toEqual({ added: 0, skipped: 2, failed: [] });
  });

  it('rejects items whose source and type disagree, and an export with no anime', async () => {
    const preview = await finish((await call('POST', '/api/import/anilist/preview', { entries: [entry(10620, 1)] })).body.id);
    const bad = { ...preview.items[0], type: 'MOVIE' };
    expect((await call('POST', '/api/import', { items: [bad] })).status).toBe(400);
    expect((await call('POST', '/api/import', { items: [{ ...preview.items[0], tv: null }] })).status).toBe(400);
    // Anime can't be sent as a book: a Books row from AniList must carry manga details.
    expect((await call('POST', '/api/import', { items: [{ ...preview.items[0], type: 'BOOK', tv: null }] })).status).toBe(400);
    expect((await call('POST', '/api/import/anilist/preview', { entries: [entry(10620, 42)] })).status).toBe(400);
    expect((await call('POST', '/api/import/anilist/preview', { entries: [entry(10620, 1, { series_type: 7 })] })).status).toBe(400);
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
