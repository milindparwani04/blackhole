import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { resetIgdbTokenForTests } from '../../apps/api/src/adapters/igdb.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };
const SECRET = 'super-secret-value-123';
let app: ReturnType<typeof buildServer>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  app = buildServer({ db: openDb(':memory:'), host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
  resetIgdbTokenForTests();
  process.env.IGDB_CLIENT_ID = 'client-id';
  process.env.IGDB_CLIENT_SECRET = SECRET;
  process.env.TMDB_API_TOKEN = 'eyJ-long-v4-read-token';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.IGDB_CLIENT_ID;
  delete process.env.IGDB_CLIENT_SECRET;
  delete process.env.TMDB_API_TOKEN;
});

describe('IGDB adapter', () => {
  it('gets a Twitch token, searches, maps results, and re-uses the cached token', async () => {
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      if (url.hostname === 'id.twitch.tv') return json({ access_token: 'tok-1', expires_in: 3600 });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
      expect(String(init.body)).toContain('search "Elden  Ring"');
      return json([
        {
          id: 119133,
          name: 'Elden Ring',
          slug: 'elden-ring',
          first_release_date: 1645747200,
          summary: '<b>Rise</b>, Tarnished',
          cover: { image_id: 'co4jni' },
          genres: [{ name: 'Role-playing (RPG)' }],
          platforms: [{ abbreviation: 'PS5', name: 'PlayStation 5' }, { abbreviation: 'PC', name: 'PC (Microsoft Windows)' }],
          involved_companies: [{ developer: true, company: { name: 'FromSoftware' } }],
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    // Injection attempt: quotes/semicolons are stripped from the Apicalypse query.
    const r = await app.inject({ method: 'GET', url: '/api/search?type=GAME&q=Elden";Ring', headers });
    const body = r.json();
    expect(body.provider_status).toBe('OK');
    expect(body.results[0]).toMatchObject({
      provider: 'IGDB',
      external_id: '119133',
      year: 2022,
      synopsis: 'Rise , Tarnished',
      cover_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
      platforms: ['PS5', 'PC'],
      creator: 'FromSoftware',
    });
    await app.inject({ method: 'GET', url: '/api/search?type=GAME&q=Elden";Ring', headers });
    expect(fetchMock.mock.calls.filter(([u]) => (u as URL).hostname === 'id.twitch.tv')).toHaveLength(1);
  });

  it('refreshes the token once when IGDB rejects it', async () => {
    let tokens = 0;
    let rejected = false;
    vi.stubGlobal('fetch', async (url: URL) => {
      if (url.hostname === 'id.twitch.tv') return json({ access_token: `tok-${++tokens}`, expires_in: 3600 });
      if (!rejected) return (rejected = true), json({ message: 'invalid token' }, 401);
      return json([]);
    });
    const r = await app.inject({ method: 'GET', url: '/api/search?type=GAME&q=halo', headers });
    expect(r.json().provider_status).toBe('OK');
    expect(tokens).toBe(2);
  });

  it('reports bad credentials without leaking them', async () => {
    vi.stubGlobal('fetch', async () => json({ message: 'invalid client secret' }, 403));
    const r = await app.inject({ method: 'POST', url: '/api/providers/IGDB/test', headers });
    expect(r.json().ok).toBe(false);
    expect(r.body).not.toContain(SECRET);
  });
});

describe('TMDb adapter', () => {
  it('searches with a bearer token and enriches runtime/director on add', async () => {
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer eyJ-long-v4-read-token');
      if (url.pathname === '/3/search/movie') {
        return json({ results: [{ id: 329865, title: 'Arrival', release_date: '2016-11-10', overview: 'Linguist', poster_path: '/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', genre_ids: [18, 878] }] });
      }
      return json({ id: 329865, runtime: 116, genres: [{ id: 18, name: 'Drama' }], credits: { crew: [{ job: 'Director', name: 'Denis Villeneuve' }] } });
    });
    const s = (await app.inject({ method: 'GET', url: '/api/search?type=MOVIE&q=arrival', headers })).json();
    expect(s.results[0]).toMatchObject({ provider: 'TMDB', title: 'Arrival', year: 2016, genres: ['Drama', 'Science Fiction'] });
    expect(s.attribution).toMatch(/not endorsed or certified by TMDB/);
    const r = s.results[0];
    const add = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers,
      payload: { type: 'MOVIE', title: r.title, year: r.year, genres: r.genres, cover_url: r.cover_url, external: { provider: 'TMDB', external_id: r.external_id } },
    });
    expect(add.json().detail.media).toMatchObject({ runtime_min: 116, creator: 'Denis Villeneuve', metadata_source: 'TMDB' });
  });

  it('uses the api_key query param for 32-char v3 keys', async () => {
    process.env.TMDB_API_TOKEN = 'a'.repeat(32);
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
      expect(url.searchParams.get('api_key')).toBe('a'.repeat(32));
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
      return json({ results: [] });
    });
    expect((await app.inject({ method: 'GET', url: '/api/search?type=MOVIE&q=x1', headers })).json().provider_status).toBe('OK');
  });
});

describe('provider registry', () => {
  it('exposes configured flags only, never key values', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/providers', headers });
    const rows = r.json();
    expect(rows.find((p: any) => p.provider === 'IGDB').configured).toBe(true);
    expect(rows.find((p: any) => p.provider === 'TVMAZE').configured).toBeNull();
    expect(r.body).not.toContain(SECRET);
    expect(r.body).not.toContain('eyJ-long-v4-read-token');
  });

  it('falls back to NOT_CONFIGURED when keys are absent', async () => {
    delete process.env.TMDB_API_TOKEN;
    const r = await app.inject({ method: 'GET', url: '/api/search?type=MOVIE&q=heat', headers });
    expect(r.json().provider_status).toBe('NOT_CONFIGURED');
  });
});
