// Reading the matched guide page (owner decision 2026-10-25): robots.txt, bot checks, roadmap-box-only extraction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { htmlToText, parseRobots, resetGuidePageStateForTests, roadmapBox, robotsAllows } from '../../apps/api/src/adapters/guidepage.js';
import { parseGuideText } from '../../apps/api/src/services/trophies.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };
let app: ReturnType<typeof buildServer>;
const call = async (method: 'GET' | 'POST', url: string, payload?: object) => (await app.inject({ method, url, headers, payload })).json() as any;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

const PAGE = `<html><head><script>var hours = "999 hours to platinum";</script></head><body>
<h1>Red Dead Redemption 2 Trophy Guide &amp; Roadmap</h1><p>March 2, 2022 by DK 210 Comments</p>
<h2>Red Dead Redemption 2 Trophy Roadmap</h2>
<ul><li>Estimated trophy difficulty : 4/10 (Story is long but easy)</li>
<li>Approximate amount of time to platinum : 120&#8211;150 Hours</li>
<li>Offline Trophies : 51</li><li>Online Trophies : 1</li>
<li>Minimum number of playthroughs : 1</li><li>Number of missable trophies : 0</li></ul>
<p>${'Lots of guide text. '.repeat(120)}</p>
<h3>210 Comments</h3><p>Reader: took me 300 hours to platinum, difficulty 9/10</p></body></html>`;

const SNIPPET_ONLY = {
  url: 'https://www.powerpyx.com/red-dead-redemption-2-trophy-guide-roadmap/',
  title: 'Red Dead Redemption 2 Trophy Guide & Roadmap - PowerPyx',
  content: 'Red Dead Redemption 2 trophy guide with all trophies and a full roadmap.',
};

beforeEach(() => {
  app = buildServer({ db: openDb(':memory:'), host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
  resetGuidePageStateForTests();
});
afterEach(() => vi.unstubAllGlobals());

async function settled(id: string) {
  for (let i = 0; i < 100; i++) {
    const d = await call('GET', `/api/library/${id}`);
    if (d.game?.trophy_job?.status !== 'RUNNING') return d;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('lookup did not finish');
}

describe('roadmap extraction', () => {
  it('reads only the roadmap box: ignores scripts and the comments section', () => {
    const box = roadmapBox(htmlToText(PAGE))!;
    expect(box).not.toMatch(/Reader:|999/);
    expect(parseGuideText(box)).toMatchObject({ hours_min: 120, hours_max: 150, difficulty_max: 4, playthroughs: 1, online_required: true, missables: false });
  });
  it('returns null when the page has no labelled roadmap', () => {
    expect(roadmapBox(htmlToText('<p>Trophy list only. Took me 40 hours.</p>'))).toBeNull();
  });
});

describe('robots.txt', () => {
  it('applies the * group, longest match, and $ / * patterns (PlayStationTrophies-style)', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /forum/members/\nAllow: /game/*/trophies/$\nDisallow: /game/*/trophies/*\n');
    expect(robotsAllows(rules, '/game/red-dead-redemption-2/guide/')).toBe(true);
    expect(robotsAllows(rules, '/game/x/trophies/')).toBe(true);
    expect(robotsAllows(rules, '/game/x/trophies/123')).toBe(false);
    expect(robotsAllows(rules, '/forum/members/5')).toBe(false);
  });
  it('AI-crawler blocks do not apply to Blackhole, but a Blackhole-specific block would', () => {
    expect(robotsAllows(parseRobots('User-agent: *\nAllow: /\nUser-agent: ClaudeBot\nDisallow: /\n'), '/guide/1-x')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: *\nAllow: /\nUser-agent: Blackhole\nDisallow: /guide/\n'), '/guide/1-x')).toBe(false);
  });
});

describe('lookup reads the matched page when the summary has no numbers', () => {
  it('fills from the guide roadmap and labels the source', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const u = new URL(String(url));
      seen.push(u.toString());
      if (u.port === '9') return json({ results: [SNIPPET_ONLY] });
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n');
      return html(PAGE);
    });
    const add = await call('POST', '/api/library', { type: 'GAME', title: 'Red Dead Redemption 2', platforms: ['PS4'] });
    const d = await settled(add.detail.entry.id);
    expect(d.game.trophy_job.status).toBe('FOUND');
    expect(d.game.trophies[0]).toMatchObject({ platform: 'PS4', hours_min: 120, hours_max: 150, difficulty_max: 4, guide_url: SNIPPET_ONLY.url });
    expect(d.game.trophies[0].source).toBe('PowerPyx (guide roadmap)');
    expect(seen.filter((s) => s.includes('powerpyx.com/red-dead'))).toHaveLength(1);
  });

  it('stops at a bot check, remembers it, and never retries that host the same day', async () => {
    const pageHits: string[] = [];
    const pst = {
      url: 'https://www.playstationtrophies.org/game/red-dead-redemption-2/guide/',
      title: 'Red Dead Redemption 2 Trophy Guide & Road Map',
      content: 'Find out the best tips and tricks.',
    };
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const u = new URL(String(url));
      if (u.port === '9') return json({ results: [pst] });
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n');
      pageHits.push(u.toString());
      return html('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script>', 403);
    });
    const add = await call('POST', '/api/library', { type: 'GAME', title: 'Red Dead Redemption 2', platforms: ['PS4'] });
    const d = await settled(add.detail.entry.id);
    expect(d.game.trophy_job.status).toBe('NOT_FOUND');
    const pstReason = (job: any) => job.candidates.find((c: any) => c.site === 'PlayStationTrophies').reason;
    expect(pstReason(d.game.trophy_job)).toMatch(/bot check/);
    expect(d.game.trophies).toHaveLength(0);
    // First lookup: one request each to PlayStationTrophies and the PowerPyx address. Refresh: neither is asked again.
    expect(new Set(pageHits.map((u) => new URL(u).hostname)).size).toBe(2);
    const r = await call('POST', `/api/games/${add.detail.entry.id}/trophy-refresh`);
    expect(pstReason(r.detail.game.trophy_job)).toMatch(/bot check/);
    expect(pageHits).toHaveLength(2);
  });

  it('tries the PowerPyx address when search misses it, but only trusts a page that names this game', async () => {
    const pageHits: string[] = [];
    let heading = 'Red Dead Redemption 2 Trophy Guide &amp; Roadmap';
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const u = new URL(String(url));
      if (u.port === '9') return json({ results: [] });
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n');
      pageHits.push(u.toString());
      return html(PAGE.replace('<h1>Red Dead Redemption 2 Trophy Guide &amp; Roadmap</h1>', `<h1>${heading}</h1>`));
    });
    const a = await call('POST', '/api/library', { type: 'GAME', title: 'Red Dead Redemption 2', year: 2018, platforms: ['PS4'] });
    const d = await settled(a.detail.entry.id);
    expect(pageHits[0]).toBe('https://www.powerpyx.com/red-dead-redemption-2-trophy-guide-roadmap/');
    expect(d.game.trophies[0]).toMatchObject({ hours_max: 150, source: 'PowerPyx (guide roadmap)' });

    resetGuidePageStateForTests();
    heading = 'Red Dead Redemption Trophy Guide &amp; Roadmap';
    const b = await call('POST', '/api/library', { type: 'GAME', title: 'Red Dead Redemption 2', year: 2018, platforms: ['PS4', 'PS5'], play_platform: 'PS5' });
    const e = await settled(b.detail.entry.id);
    expect(e.game.trophies).toHaveLength(0);
    expect(e.game.trophy_job.candidates[0].reason).toMatch(/different game/);
  });

  it('rejects a guide written before the game was released (older version of the same name)', async () => {
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const u = new URL(String(url));
      if (u.port === '9') return json({ results: [] });
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n');
      return html(PAGE.replace('Red Dead Redemption 2 Trophy Guide &amp; Roadmap', 'Resident Evil 4 Trophy Guide &amp; Roadmap').replace('March 2, 2022', 'August 30, 2016'));
    });
    const a = await call('POST', '/api/library', { type: 'GAME', title: 'Resident Evil 4', year: 2023, platforms: ['PS5'] });
    const d = await settled(a.detail.entry.id);
    expect(d.game.trophies).toHaveLength(0);
    expect(d.game.trophy_job.candidates[0].reason).toMatch(/written in 2016, before this 2023 release/);
  });

  it('honours robots.txt and never fetches pages from non-guide hosts', async () => {
    const pageHits: string[] = [];
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const u = new URL(String(url));
      if (u.port === '9') return json({ results: [SNIPPET_ONLY, { ...SNIPPET_ONLY, url: 'https://evil.example/red-dead-redemption-2-trophy-guide-roadmap/' }] });
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n');
      pageHits.push(u.toString());
      return html(PAGE);
    });
    const add = await call('POST', '/api/library', { type: 'GAME', title: 'Red Dead Redemption 2', platforms: ['PS4'] });
    const d = await settled(add.detail.entry.id);
    expect(pageHits).toHaveLength(0);
    expect(d.game.trophy_job.candidates[0].reason).toMatch(/robots\.txt/);
  });
});
