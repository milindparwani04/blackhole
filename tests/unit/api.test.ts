import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, run, type DB } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { setTodayForTests } from '../../apps/api/src/services/library.js';
import { plainText, safeImage } from '../../apps/api/src/adapters/http.js';

const PORT = 4317;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let db: DB;
let app: ReturnType<typeof buildServer>;

const headers = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, 'x-blackhole': '1' };
const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers, payload });
  return { status: res.statusCode, body: res.json() as any };
};
const add = (body: object) => call('POST', '/api/library', body);

beforeEach(() => {
  db = openDb(':memory:');
  app = buildServer({ db, host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
  setTodayForTests(() => '2026-10-25');
});

describe('security boundary', () => {
  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:4317' } });
    expect(res.statusCode).toBe(403);
  });
  it('rejects cross-origin mutations and mutations without the custom header', async () => {
    const evil = await app.inject({ method: 'POST', url: '/api/library', headers: { ...headers, origin: 'https://evil.example' }, payload: { type: 'GAME', title: 'x' } });
    expect(evil.statusCode).toBe(403);
    const noHeader = await app.inject({ method: 'POST', url: '/api/library', headers: { host: headers.host, origin: ORIGIN }, payload: { type: 'GAME', title: 'x' } });
    expect(noHeader.statusCode).toBe(403);
  });
  it('rejects non-https URLs', async () => {
    const r = await add({ type: 'GAME', title: 'Bad', cover_url: 'javascript:alert(1)' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('strips markup from provider text and only allows known image hosts', () => {
    expect(plainText('<p>Hello <script>alert(1)</script><b>world</b></p>')).toBe('Hello alert(1) world');
    expect(safeImage('https://evil.example/x.png')).toBeNull();
    expect(safeImage('http://static.tvmaze.com/a.jpg')).toBe('https://static.tvmaze.com/a.jpg');
  });
});

describe('library CRUD', () => {
  it('adds two same-title games without merging, and survives filters', async () => {
    const a = await add({ type: 'GAME', title: 'Resident Evil 4', year: 2005, platforms: ['PS2'] });
    const b = await add({ type: 'GAME', title: 'Resident Evil 4', year: 2023, platforms: ['PS5'] });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.detail.entry.id).not.toBe(b.body.detail.entry.id);
    const list = await call('GET', '/api/library?type=GAME');
    expect(list.body).toHaveLength(2);
  });

  it('is idempotent for provider-backed adds', async () => {
    const body = { type: 'BOOK', title: 'Dune', external: { provider: 'OPENLIBRARY', external_id: '/works/OL893415W' }, pages: 412 };
    const a = await add(body);
    const b = await add(body);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.detail.entry.id).toBe(a.body.detail.entry.id);
  });

  it('archives, restores and permanently removes archived entries', async () => {
    const { body } = await add({ type: 'MOVIE', title: 'Heat', year: 1995 });
    const id = body.detail.entry.id;
    await call('POST', `/api/library/${id}/archive`, { archived: true });
    expect((await call('GET', '/api/library?type=MOVIE')).body).toHaveLength(0);
    expect((await call('GET', '/api/library?archived=true')).body).toHaveLength(1);
    expect((await call('DELETE', `/api/library/${id}`)).status).toBe(200);
    expect((await call('GET', '/api/library?archived=true')).body).toHaveLength(0);
    expect((await call('GET', `/api/library/${id}`)).status).toBe(404);
  });

  it('removes an entry straight from the backlog without archiving or typing the title', async () => {
    const { body } = await add({ type: 'MOVIE', title: 'Ronin', year: 1998 });
    const id = body.detail.entry.id;
    expect((await call('DELETE', `/api/library/${id}`)).status).toBe(200);
    expect((await call('GET', '/api/library?type=MOVIE')).body).toHaveLength(0);
  });

  it('enforces optimistic concurrency on PATCH', async () => {
    const { body } = await add({ type: 'MOVIE', title: 'Alien' });
    const id = body.detail.entry.id;
    const v = body.detail.entry.version;
    expect((await call('PATCH', `/api/library/${id}`, { version: v, notes: 'first' })).status).toBe(200);
    expect((await call('PATCH', `/api/library/${id}`, { version: v, notes: 'stale' })).status).toBe(409);
  });
});

describe('completion and undo', () => {
  it('keeps story completion and platinum independent', async () => {
    const { body } = await add({ type: 'GAME', title: 'Elden Ring', platforms: ['PS5', 'PC'] });
    const id = body.detail.entry.id;
    const plat = await call('POST', `/api/library/${id}/complete`, { kind: 'PLATINUM', done: true });
    expect(plat.body.detail.entry.platinum_earned_at).not.toBeNull();
    expect(plat.body.detail.entry.story_completed_at).toBeNull();
    const story = await call('POST', `/api/library/${id}/complete`, { kind: 'STORY', done: true });
    expect(story.body.detail.entry.status).toBe('COMPLETED');
    const undone = await call('POST', `/api/events/${story.body.event_id}/undo`);
    expect(undone.body.detail.entry.story_completed_at).toBeNull();
    expect(undone.body.detail.entry.status).toBe('PLANNED');
    expect(undone.body.detail.entry.platinum_earned_at).not.toBeNull();
  });

  it('refuses platinum on non-PlayStation games', async () => {
    const { body } = await add({ type: 'GAME', title: 'Halo', platforms: ['Xbox'] });
    expect(body.detail.game.platinum_applicable).toBe(false);
    expect((await call('POST', `/api/library/${body.detail.entry.id}/complete`, { kind: 'PLATINUM', done: true })).status).toBe(400);
  });

  it('only allows undoing the most recent change', async () => {
    const { body } = await add({ type: 'MOVIE', title: 'Arrival' });
    const id = body.detail.entry.id;
    const first = await call('POST', `/api/library/${id}/complete`, { kind: 'WATCHED', done: true });
    await call('PATCH', `/api/library/${id}`, { version: first.body.detail.entry.version, personal_rating: 9 });
    expect((await call('POST', `/api/events/${first.body.event_id}/undo`)).status).toBe(409);
  });

  it('a failed trophy refresh (search offline) reports an error and leaves saved values untouched', async () => {
    const { body } = await add({ type: 'GAME', title: 'Bloodborne', platforms: ['PS4'] });
    const id = body.detail.entry.id;
    await call('PUT', `/api/games/${id}/trophies`, { platform: 'PS4', platinum: 'YES', hours_min: 50, hours_max: 60, difficulty_min: 6, difficulty_max: 6 });
    const r = await call('POST', `/api/games/${id}/trophy-refresh`);
    expect(r.status).toBe(200);
    expect(r.body.detail.game.trophy_job.status).toBe('ERROR');
    expect(r.body.detail.game.trophies[0].hours_max).toBe(60);
  });
});

describe('TV episode arithmetic', () => {
  async function seededShow() {
    const { body } = await add({ type: 'TV', title: 'Test Show', runtime_min: 40 });
    const id = body.detail.entry.id;
    const mediaId = body.detail.media.id;
    // S0 special, S1 x3 aired, S2: E1 aired, E2 unaired.
    const seasons = [
      { sid: 's0', n: 0, special: 1 },
      { sid: 's1', n: 1, special: 0 },
      { sid: 's2', n: 2, special: 0 },
    ];
    for (const s of seasons) run(db, 'INSERT INTO tv_seasons VALUES (:id, :m, :n, :sp)', { id: `${mediaId}-${s.sid}`, m: mediaId, n: s.n, sp: s.special });
    const eps = [
      ['s0', 1, '2020-01-01', null],
      ['s1', 1, '2020-02-01', 45],
      ['s1', 2, '2020-02-08', 45],
      ['s1', 3, '2020-02-15', null],
      ['s2', 1, '2026-10-25', 50],
      ['s2', 2, '2026-11-01', 50],
    ] as const;
    eps.forEach(([sid, n, air, rt], i) =>
      run(db, `INSERT INTO tv_episodes VALUES (:id, :sid, :m, 'TEST', :pid, :n, NULL, :air, :rt, NULL)`, {
        id: crypto.randomUUID(),
        sid: `${mediaId}-${sid}`,
        m: mediaId,
        pid: `${mediaId}-${i}`,
        n,
        air,
        rt,
      }),
    );
    return { id, detail: (await call('GET', `/api/library/${id}`)).body };
  }

  it('counts released regular episodes only and supports out-of-order watching', async () => {
    const { id, detail } = await seededShow();
    expect(detail.tv.progress.eligible).toBe(4);
    expect(detail.tv.progress.unreleased).toBe(1);
    const s1e3 = detail.tv.seasons.find((s: any) => s.number === 1 && !s.is_special).episodes[2];
    const r = await call('POST', `/api/tv/${id}/episodes/${s1e3.id}/watch`, { watched: true });
    expect(r.body.detail.tv.progress.watched).toBe(1);
    expect(r.body.detail.entry.status).toBe('IN_PROGRESS');
    // Missing runtime falls back to the show average and is labelled estimated.
    expect(r.body.detail.tv.progress.watched_minutes).toBe(40);
    expect(r.body.detail.tv.progress.runtime_estimated).toBe(true);
  });

  it('refuses to mark an unaired episode watched', async () => {
    const { id, detail } = await seededShow();
    const unaired = detail.tv.seasons.find((s: any) => s.number === 2).episodes[1];
    expect((await call('POST', `/api/tv/${id}/episodes/${unaired.id}/watch`, { watched: true })).status).toBe(400);
  });

  it('bulk completion skips unaired episodes, auto-completes the series (D-04), and one undo reverts both', async () => {
    const { id } = await seededShow();
    const r = await call('POST', `/api/tv/${id}/seasons/all/watch`, { watched: true });
    expect(r.body.detail.tv.progress.watched).toBe(4);
    expect(r.body.detail.entry.status).toBe('COMPLETED');
    const s2 = r.body.detail.tv.seasons.find((s: any) => s.number === 2);
    expect(s2.episodes[1].watched).toBe(false);
    const u = await call('POST', `/api/events/${r.body.event_id}/undo`);
    expect(u.body.detail.tv.progress.watched).toBe(0);
    expect(u.body.detail.entry.status).toBe('PLANNED');
  });

  it('creates manual season structures', async () => {
    const { body } = await add({ type: 'TV', title: 'Manual Show', season_counts: [3, 5] });
    expect(body.detail.tv.seasons).toHaveLength(2);
    expect(body.detail.tv.progress.eligible).toBe(8);
  });
});

describe('books', () => {
  it('rejects pages beyond the edition and finishing sets page to total', async () => {
    const { body } = await add({ type: 'BOOK', title: 'Book', pages: 300 });
    const id = body.detail.entry.id;
    expect((await call('PATCH', `/api/library/${id}`, { version: body.detail.entry.version, current_page: 301 })).status).toBe(400);
    const p = await call('PATCH', `/api/library/${id}`, { version: body.detail.entry.version, current_page: 120 });
    expect(p.body.detail.entry.status).toBe('IN_PROGRESS');
    const f = await call('POST', `/api/library/${id}/complete`, { kind: 'FINISHED', done: true });
    expect(f.body.detail.entry.current_page).toBe(300);
    expect(f.body.detail.entry.status).toBe('COMPLETED');
  });
});
