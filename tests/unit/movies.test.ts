import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { resetGuidePageStateForTests } from '../../apps/api/src/adapters/guidepage.js';
import { parseRtPage, rtSlug } from '../../apps/api/src/adapters/rottentomatoes.js';
import { movieRatingsSettled, resetMovieRatingStateForTests } from '../../apps/api/src/services/movies.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };
let app: ReturnType<typeof buildServer>;
let dataDir: string;

const rtPage = (titleName: string, year: number, audience: string) =>
  `<html><head><meta property="og:title" content="${titleName} | Rotten Tomatoes"></head><body><script>{"titleName":"${titleName}","releaseYear":"${year}",` +
  `"audienceScore":{"bandedRatingCount":"5,000+ Verified Ratings","score":${audience},"scoreType":"VERIFIED"}}</script></body></html>`;

describe('Rotten Tomatoes page parsing', () => {
  it('builds RT-style slugs', () => {
    expect(rtSlug('Dune: Part Two')).toBe('dune_part_two');
    expect(rtSlug("Ocean's Eleven")).toBe('oceans_eleven');
    expect(rtSlug('Amélie & Co.')).toBe('amelie_and_co');
  });

  it('reads the audience score only when title and year match', () => {
    const html = rtPage('Dune (2021)', 2021, '"90"');
    expect(parseRtPage(html, 'Dune', 2021)).toEqual({ score: 90, label: '5,000+ Verified Ratings' });
    expect(parseRtPage(html, 'Dune', 1984)).toBeNull();
    expect(parseRtPage(html, 'Arrival', 2021)).toBeNull();
    // No audience score yet (too few ratings) stays unknown rather than 0.
    expect(parseRtPage(rtPage('Dune (2021)', 2021, 'null'), 'Dune', 2021)).toBeNull();
  });
});

describe('movie ratings on add', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-movies-'));
    app = buildServer({ db: openDb(':memory:'), host: '127.0.0.1', port: PORT, dataDir });
    process.env.TMDB_API_TOKEN = 'eyJ-long-v4-read-token';
    resetGuidePageStateForTests();
    resetMovieRatingStateForTests();
    const ratings = zlib.gzipSync('tconst\taverageRating\tnumVotes\ntt1160419\t8.0\t950000\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const u = new URL(String(url));
        if (u.hostname === 'api.themoviedb.org')
          return new Response(JSON.stringify({ id: 438631, title: 'Dune', release_date: '2021-09-15', runtime: 155, imdb_id: 'tt1160419', genres: [], credits: { crew: [] } }));
        if (u.hostname === 'datasets.imdbws.com') return new Response(ratings);
        if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /search\n');
        if (u.pathname === '/m/dune_2021') return new Response(rtPage('Dune (2021)', 2021, '"90"'));
        return new Response('not found', { status: 404 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TMDB_API_TOKEN;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('stores IMDb and RT audience ratings, lists them, and filters can rely on them', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers,
      payload: { type: 'MOVIE', title: 'Dune', year: 2021, external: { provider: 'TMDB', external_id: '438631' } },
    });
    expect(res.statusCode).toBe(201);
    // The add returns at once; ratings load in the background and the detail says so.
    const added = res.json().detail;
    expect(added.movie.ratings_pending).toBe(true);
    await movieRatingsSettled(added.media.id);
    const detail = (await app.inject({ method: 'GET', url: `/api/library/${added.entry.id}`, headers })).json();
    const movie = detail.movie;
    expect(movie.ratings_pending).toBe(false);
    expect(movie.ratings.imdb).toMatchObject({ score: 8, scale: 10, votes: 950000, url: 'https://www.imdb.com/title/tt1160419/' });
    expect(movie.ratings.rt_audience).toMatchObject({ score: 90, scale: 100, url: 'https://www.rottentomatoes.com/m/dune_2021' });
    expect(movie.attribution.join(' ')).toContain('IMDb');

    const rows = (await app.inject({ method: 'GET', url: '/api/library?type=MOVIE', headers })).json();
    expect(rows[0].ratings.rt_audience.score).toBe(90);
  });

  it('previews ratings for a search result without storing anything', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/movies/preview-ratings?tmdb=438631', headers })).json();
    expect(r.imdb.score).toBe(8);
    expect(r.rt_audience.score).toBe(90);
    expect((await app.inject({ method: 'GET', url: '/api/library?type=MOVIE', headers })).json()).toHaveLength(0);
  });
});
