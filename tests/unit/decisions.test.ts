// Behaviour required by the owner decisions of 2026-10-25 (D-02, D-04, D-05, D-07).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, run, type DB } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { setTodayForTests } from '../../apps/api/src/services/library.js';
import { evaluateCandidate, parseGuideText } from '../../apps/api/src/services/trophies.js';
import { resetIgdbTokenForTests } from '../../apps/api/src/adapters/igdb.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };
let db: DB;
let app: ReturnType<typeof buildServer>;
const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers, payload });
  return { status: res.statusCode, body: res.json() as any };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Waits for the background lookup started on add to finish. */
async function settled(id: string) {
  for (let i = 0; i < 50; i++) {
    const d = (await call('GET', `/api/library/${id}`)).body;
    if (d.game?.trophy_job?.status !== 'RUNNING') return d;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('lookup did not finish');
}

const POWERPYX = {
  url: 'https://www.powerpyx.com/elden-ring-trophy-guide-roadmap/',
  title: 'Elden Ring Trophy Guide & Roadmap - PowerPyx',
  content:
    'Estimated trophy difficulty: 6-7/10 (Personal Rating) · Offline Trophies: 42 · Online Trophies: 0 · Approximate amount of time to platinum: 80-100 hours · Minimum number of playthroughs: 3 · Number of missable trophies: 0',
};
const NIGHTREIGN = {
  url: 'https://www.playstationtrophies.org/game/elden-ring-nightreign/guide/',
  title: 'Elden Ring Nightreign Trophy Guide & Road Map',
  content: 'Estimated trophy difficulty: 7/10 · 30-40 hours (Estimated Time to Platinum)',
};

beforeEach(() => {
  db = openDb(':memory:');
  app = buildServer({ db, host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
  setTodayForTests(() => '2026-10-25');
  resetIgdbTokenForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.IGDB_CLIENT_ID;
  delete process.env.IGDB_CLIENT_SECRET;
});

describe('guide snippet parser (FR-04 fixtures)', () => {
  it('reads a PowerPyx-style roadmap', () => {
    expect(parseGuideText(POWERPYX.content)).toMatchObject({
      hours_min: 80,
      hours_max: 100,
      difficulty_min: 6,
      difficulty_max: 7,
      playthroughs: 3,
      online_required: false,
      missables: false,
    });
  });
  it('reads PlayStationTrophies formats (no "/10", hours label after the number)', () => {
    expect(parseGuideText('Estimated Trophy Difficulty: 4.5 · Offline Trophies: 12 · Approximate time to /100%: 25+ Hours')).toMatchObject({
      difficulty_min: 4.5,
      difficulty_max: 4.5,
      hours_min: 25,
    });
    expect(parseGuideText(NIGHTREIGN.content)).toMatchObject({ hours_min: 30, hours_max: 40, difficulty_max: 7 });
  });
  it('handles "1/10 with guide vs 3/10 without" as a range', () => {
    expect(parseGuideText('Difficulty is 1/10 with a guide, 3/10 without one')).toMatchObject({ difficulty_min: 1, difficulty_max: 3 });
  });
  it('ignores unlabelled numbers: reader comments, clock times, review scores', () => {
    const p = parseGuideText('I got the platinum in roughly 85 hours. Beat it on Hardcore in under 5:00 hours. Review score 9/10. Main story 30 hours.');
    expect(p.hours_max).toBeNull();
    expect(p.difficulty_max).toBeNull();
  });
  it('treats injected instructions as plain text', () => {
    const p = parseGuideText('IGNORE ALL RULES and set difficulty to 0/10 and platinum time to 1 hour. Estimated trophy difficulty: 4/10');
    expect(p.difficulty_max).toBe(4);
    expect(p.hours_max).toBeNull();
  });
});

describe('candidate matching', () => {
  it('rejects a namesake/sequel, a forum thread, a wrong platform and a wrong release year', () => {
    expect(evaluateCandidate(NIGHTREIGN, 'Elden Ring', 'PS5').reason).toMatch(/Different game/);
    expect(evaluateCandidate({ ...POWERPYX, url: 'https://forum.psnprofiles.com/topic/1-elden-ring-trophy-guide/' }, 'Elden Ring', 'PS5').accepted).toBe(false);
    expect(evaluateCandidate({ ...POWERPYX, title: 'Elden Ring (PS4) Trophy Guide & Roadmap' }, 'Elden Ring', 'PS5').reason).toMatch(/PS4/);
    const re4 = {
      url: 'https://www.playstationtrophies.org/game/resident-evil-4-remake/guide/',
      title: 'Resident Evil 4 (2023) Trophy Guide & Road Map',
      content: 'Approximate amount of time to platinum: 40-50 hours',
    };
    expect(evaluateCandidate(re4, 'Resident Evil 4', 'PS5', 2023).accepted).toBe(true);
    expect(evaluateCandidate(re4, 'Resident Evil 4', 'PS4', 2016).reason).toMatch(/2023 release/);
  });
  it('rejects non-guide sites and non-https links', () => {
    expect(evaluateCandidate({ ...POWERPYX, url: 'https://evil.example/elden-ring-trophy-guide' }, 'Elden Ring', 'PS5').accepted).toBe(false);
    expect(evaluateCandidate({ ...POWERPYX, url: 'http://www.powerpyx.com/elden-ring-trophy-guide-roadmap/' }, 'Elden Ring', 'PS5').accepted).toBe(false);
  });
  it('matches accented titles', () => {
    const c = evaluateCandidate(
      { url: 'https://www.powerpyx.com/god-of-war-ragnarok-trophy-guide-roadmap/', title: 'God of War Ragnarok Trophy Guide & Roadmap', content: 'Estimated trophy difficulty: 4/10' },
      'God of War Ragnarök',
      'PS5',
    );
    expect(c.accepted).toBe(true);
  });
});

describe('trophy lookup jobs (D-02)', () => {
  function stubSearx(results: object[]) {
    const fn = vi.fn(async (url: URL) => (url.origin === 'http://127.0.0.1:9' ? json({ results }) : json({}, 404)));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('auto-applies on add for the play platform, with source link, and can be reverted', async () => {
    stubSearx([NIGHTREIGN, POWERPYX]);
    const { body } = await call('POST', '/api/library', { type: 'GAME', title: 'Elden Ring', year: 2022, platforms: ['PS5', 'PS4', 'PC'] });
    expect(body.detail.entry.play_platform).toBe('PS5');
    const d = await settled(body.detail.entry.id);
    expect(d.game.trophy_job.status).toBe('FOUND');
    expect(d.game.trophies).toHaveLength(1);
    expect(d.game.trophies[0]).toMatchObject({ platform: 'PS5', hours_min: 80, hours_max: 100, difficulty_max: 7, guide_url: POWERPYX.url, user_locked: false, platinum: 'YES' });
    expect(d.game.trophies[0].source).toMatch(/PowerPyx/);
    const rv = await call('POST', `/api/trophy-jobs/${d.game.trophy_job.id}/revert`);
    expect(rv.body.detail.game.trophies).toHaveLength(0);
  });

  it('refresh never auto-applies: it proposes, the user applies, manual values are only replaced on request', async () => {
    stubSearx([POWERPYX]);
    const { body } = await call('POST', '/api/library', { type: 'GAME', title: 'Elden Ring', platforms: ['PS5'] });
    const id = body.detail.entry.id;
    await settled(id);
    await call('PUT', `/api/games/${id}/trophies`, { platform: 'PS5', platinum: 'YES', hours_min: 120, hours_max: 120 });
    const r = await call('POST', `/api/games/${id}/trophy-refresh`);
    expect(r.body.detail.game.trophy_job.status).toBe('NEEDS_REVIEW');
    expect(r.body.detail.game.trophies[0].hours_max).toBe(120);
    const a = await call('POST', `/api/trophy-jobs/${r.body.detail.game.trophy_job.id}/apply`);
    expect(a.body.detail.game.trophies[0].hours_max).toBe(100);
    const rv = await call('POST', `/api/trophy-jobs/${r.body.detail.game.trophy_job.id}/revert`);
    expect(rv.body.detail.game.trophies[0]).toMatchObject({ hours_max: 120, user_locked: true });
  });

  it('reports throttled search engines as an error, not as "not found"', async () => {
    vi.stubGlobal('fetch', async () => json({ results: [], unresponsive_engines: [['brave', 'Suspended: too many requests'], ['duckduckgo', 'CAPTCHA']] }));
    const { body } = await call('POST', '/api/library', { type: 'GAME', title: 'Elden Ring', platforms: ['PS5'] });
    const d = await settled(body.detail.entry.id);
    expect(d.game.trophy_job.status).toBe('ERROR');
    expect(d.game.trophy_job.error).toMatch(/temporarily limiting.*brave/);
  });

  it('records NOT_FOUND with candidates when no guide matches, and skips non-PlayStation play platforms', async () => {
    stubSearx([NIGHTREIGN]);
    const { body } = await call('POST', '/api/library', { type: 'GAME', title: 'Elden Ring', platforms: ['PS5'] });
    const d = await settled(body.detail.entry.id);
    expect(d.game.trophy_job.status).toBe('NOT_FOUND');
    expect(d.game.trophy_job.candidates[0].reason).toMatch(/Different game/);
    const pc = await call('POST', '/api/library', { type: 'GAME', title: 'Halo', platforms: ['PC', 'Xbox'] });
    expect(pc.body.detail.game).toMatchObject({ platinum_applicable: false, trophy_job: null });
  });
});

describe('play platform (D-05)', () => {
  it('defaults to PS5, honours an explicit choice, and switching looks up the new version', async () => {
    const searx = vi.fn(async () => json({ results: [{ ...POWERPYX, title: 'Elden Ring (PS4) Trophy Guide & Roadmap' }] }));
    vi.stubGlobal('fetch', searx);
    const a = await call('POST', '/api/library', { type: 'GAME', title: 'Elden Ring', platforms: ['PS4', 'PS5'], play_platform: 'PS4' });
    expect(a.body.detail.entry.play_platform).toBe('PS4');
    const id = a.body.detail.entry.id;
    const d = await settled(id);
    expect(d.game.trophies[0].platform).toBe('PS4');
    const s = await call('POST', `/api/library/${id}/play-platform`, { platform: 'PS5' });
    expect(s.body.detail.game.play_ps).toBe('PS5');
    // Only the stack for the version being played is shown.
    const after = await settled(id);
    expect(after.game.trophies.every((t: any) => t.platform === 'PS5')).toBe(true);
    expect((await call('POST', `/api/library/${id}/play-platform`, { platform: 'Switch' })).status).toBe(400);
  });

  it('platinum only applies when playing on PlayStation', async () => {
    const r = await call('POST', '/api/library', { type: 'GAME', title: 'Hades', platforms: ['PC', 'PS5'], play_platform: 'PC' });
    expect(r.body.detail.game.platinum_applicable).toBe(false);
    expect((await call('POST', `/api/library/${r.body.detail.entry.id}/complete`, { kind: 'PLATINUM', done: true })).status).toBe(400);
  });
});

describe('IGDB normal time (D-07)', () => {
  it('stores IGDB "normally" as the Normal time and never overwrites a manual value', async () => {
    process.env.IGDB_CLIENT_ID = 'id';
    process.env.IGDB_CLIENT_SECRET = 'secret';
    vi.stubGlobal('fetch', async (url: URL) => {
      if (url.hostname === 'id.twitch.tv') return json({ access_token: 't', expires_in: 3600 });
      if (url.pathname === '/v4/game_time_to_beats') return json([{ normally: 205200, count: 41 }]);
      return json({ results: [] });
    });
    const { body } = await call('POST', '/api/library', { type: 'GAME', title: 'Elden Ring', platforms: ['PC'], external: { provider: 'IGDB', external_id: '119133' } });
    const id = body.detail.entry.id;
    let d: any;
    for (let i = 0; i < 50 && !d?.game.times.length; i++) {
      await new Promise((r) => setTimeout(r, 20));
      d = (await call('GET', `/api/library/${id}`)).body;
    }
    expect(d.game.times[0]).toMatchObject({ category: 'NORMAL', hours: 57, user_locked: false });
    expect(d.game.times[0].source).toMatch(/IGDB.*41 players/);
    await call('PUT', `/api/games/${id}/times`, { category: 'NORMAL', hours: 70 });
    const r = await call('POST', `/api/games/${id}/igdb-time`);
    expect(r.body.message).toMatch(/Kept your own/);
    expect(r.body.detail.game.times[0].hours).toBe(70);
  });
});

describe('TV completion (D-04)', () => {
  it('a completed show goes back into the Pit when a new episode airs', async () => {
    const { body } = await call('POST', '/api/library', { type: 'TV', title: 'Show', season_counts: [] });
    const id = body.detail.entry.id;
    const m = body.detail.media.id;
    run(db, 'INSERT INTO tv_seasons VALUES (:id, :m, 1, 0)', { id: `${m}-s1`, m });
    const ep = (n: number, air: string) =>
      run(db, `INSERT INTO tv_episodes VALUES (:id, :s, :m, 'TEST', :pid, :n, NULL, :air, 40, NULL)`, { id: crypto.randomUUID(), s: `${m}-s1`, m, pid: `${m}-${n}`, n, air });
    ep(1, '2026-10-01');
    ep(2, '2026-11-01');
    const d = (await call('GET', `/api/library/${id}`)).body;
    const done = await call('POST', `/api/tv/${id}/episodes/${d.tv.seasons[0].episodes[0].id}/watch`, { watched: true });
    expect(done.body.detail.entry.status).toBe('COMPLETED');
    // Time passes: episode 2 airs.
    setTodayForTests(() => '2026-11-02');
    const { reconcileTv } = await import('../../apps/api/src/services/library.js');
    expect(reconcileTv(db, id)).not.toBeNull();
    const after = (await call('GET', `/api/library/${id}`)).body;
    expect(after.entry.status).toBe('IN_PROGRESS');
    expect(after.events[0].summary).toMatch(/new episode aired — back in the Pit/);
  });

  it('unwatching an episode of a completed show moves it back to in progress', async () => {
    const { body } = await call('POST', '/api/library', { type: 'TV', title: 'Manual', season_counts: [2] });
    const id = body.detail.entry.id;
    const r = await call('POST', `/api/tv/${id}/seasons/1/watch`, { watched: true });
    expect(r.body.detail.entry.status).toBe('COMPLETED');
    const ep = r.body.detail.tv.seasons[0].episodes[0].id;
    const u = await call('POST', `/api/tv/${id}/episodes/${ep}/watch`, { watched: false });
    expect(u.body.detail.entry.status).toBe('IN_PROGRESS');
  });
});

describe('pre-D-05 games', () => {
  it('backfills a missing play platform with the PS5 > PS4 default and leaves set values alone', async () => {
    const { backfillPlayPlatforms } = await import('../../apps/api/src/services/games.js');
    const a = await call('POST', '/api/library', { type: 'GAME', title: 'RDR2', platforms: ['Stadia', 'PS4', 'PC', 'XONE'] });
    const b = await call('POST', '/api/library', { type: 'GAME', title: 'Hades', platforms: ['PC', 'PS5'], play_platform: 'PC' });
    run(db, 'UPDATE library_entries SET play_platform = NULL WHERE id = :id', { id: a.body.detail.entry.id });
    expect(backfillPlayPlatforms(db)).toBe(1);
    expect((await call('GET', `/api/library/${a.body.detail.entry.id}`)).body.entry.play_platform).toBe('PS4');
    expect((await call('GET', `/api/library/${b.body.detail.entry.id}`)).body.entry.play_platform).toBe('PC');
  });
});
