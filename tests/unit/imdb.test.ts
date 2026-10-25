import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, run, type DB } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { setTodayForTests } from '../../apps/api/src/services/library.js';
import { linkImdbId, syncImdbRatings } from '../../apps/api/src/adapters/imdb.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };
let db: DB;
let app: ReturnType<typeof buildServer>;
let dataDir: string;

const gz = (rows: string[]) => zlib.gzipSync(rows.join('\n') + '\n');
const EPISODES = gz([
  'tconst\tparentTconst\tseasonNumber\tepisodeNumber',
  'tt0000101\ttt1234567\t1\t1',
  'tt0000102\ttt1234567\t1\t2',
  'tt0000103\ttt1234567\t\\N\t\\N',
  'tt0000901\ttt7654321\t1\t1',
]);
const RATINGS = gz(['tconst\taverageRating\tnumVotes', 'tt0000101\t8.7\t5120', 'tt0000103\t9.9\t10', 'tt0000901\t2.0\t50']);

beforeEach(() => {
  db = openDb(':memory:');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-imdb-'));
  app = buildServer({ db, host: '127.0.0.1', port: PORT, dataDir });
  setTodayForTests(() => '2026-10-25');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      if (url.hostname === 'api.tvmaze.com') return new Response(JSON.stringify({ id: 1, externals: { imdb: 'tt1234567' } }));
      if (url.hostname === 'datasets.imdbws.com') return new Response(url.pathname.includes('episode') ? EPISODES : RATINGS);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('IMDb episode ratings', () => {
  it('matches by season/episode, prefers IMDb over TVmaze, and leaves unrated episodes unrated', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/library', headers, payload: { type: 'TV', title: 'Test Show' } });
    const { entry, media } = res.json().detail;
    run(db, `INSERT INTO tv_seasons VALUES ('s1', :m, 1, 0)`, { m: media.id });
    for (const [id, n] of [
      ['e1', 1],
      ['e2', 2],
    ] as const) {
      run(db, `INSERT INTO tv_episodes VALUES (:id, 's1', :m, 'TVMAZE', :id, :n, NULL, '2020-01-01', 40, NULL)`, { id, m: media.id, n });
      run(db, `INSERT INTO episode_ratings VALUES (:id, 'TVMAZE', 6.1, 10, '2026-10-01')`, { id });
    }

    expect(await linkImdbId(db, media.id, '1')).toBe('tt1234567');
    expect(await syncImdbRatings(db, dataDir)).toEqual({ rated: 1 });
    expect(fs.existsSync(path.join(dataDir, 'imdb', 'title.ratings.tsv.gz'))).toBe(true);

    const tv = (await app.inject({ method: 'GET', url: `/api/library/${entry.id}`, headers })).json().tv;
    const [e1, e2] = tv.seasons[0].episodes;
    expect(e1.rating).toMatchObject({ provider: 'IMDB', score: 8.7, scale: 10 });
    // IMDb has no rating for E2: it shows as unavailable rather than falling back to TVmaze's number.
    expect(e2.rating).toBeNull();
    expect(tv.ratings_attribution).toContain('IMDb');

    // Second full run with unchanged datasets is skipped without re-downloading.
    const calls = (fetch as any).mock.calls.length;
    expect(await syncImdbRatings(db, dataDir)).toEqual({ rated: 0 });
    expect((fetch as any).mock.calls.length).toBe(calls);
  });

  it('falls back to TVmaze ratings for a show IMDb has none for', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/library', headers, payload: { type: 'TV', title: 'Obscure Show' } });
    const { entry, media } = res.json().detail;
    run(db, `INSERT INTO tv_seasons VALUES ('s1', :m, 1, 0)`, { m: media.id });
    run(db, `INSERT INTO tv_episodes VALUES ('e1', 's1', :m, 'TVMAZE', 'e1', 1, NULL, '2020-01-01', 40, NULL)`, { m: media.id });
    run(db, `INSERT INTO episode_ratings VALUES ('e1', 'TVMAZE', 7.4, 10, '2026-10-01')`);
    const tv = (await app.inject({ method: 'GET', url: `/api/library/${entry.id}`, headers })).json().tv;
    expect(tv.seasons[0].episodes[0].rating).toMatchObject({ provider: 'TVMAZE', score: 7.4 });
    expect(tv.ratings_attribution).toContain('TVmaze');
  });
});
