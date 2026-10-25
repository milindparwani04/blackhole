import { AppError } from '../security/errors.js';

/**
 * Owner decision 2026-10-25: Blackhole may read the single guide page that already matched a game, to take the
 * values from its roadmap box. Rules: allowlisted guide hosts only, robots.txt honoured, bot checks (Cloudflare etc.)
 * are reported and never worked around, size/time capped, requests spaced out.
 * Owner decision 2026-10-25: the same rules cover one Rotten Tomatoes /m/ page per movie (audience score), and the
 * owner's own Letterboxd film/watchlist grid pages for the one-off import (adapters/letterboxd.ts).
 */
const PAGE_HOSTS = new Set(['www.powerpyx.com', 'powerpyx.com', 'knoef.info', 'www.knoef.info', 'www.playstationtrophies.org', 'playstationtrophies.org', 'psnprofiles.com', 'www.psnprofiles.com', 'www.rottentomatoes.com', 'letterboxd.com']);
const UA = 'Blackhole/0.1 (local personal media library)';
const MAX_BYTES = 2_000_000;
const DAY = 24 * 60 * 60 * 1000;

const robotsCache = new Map<string, { rules: RobotsRule[]; at: number }>();
/** Hosts that showed a bot check; not retried for a day. */
const blockedUntil = new Map<string, number>();

export function resetGuidePageStateForTests() {
  robotsCache.clear();
  blockedUntil.clear();
  lastAt = 0;
  queue = Promise.resolve();
}

// ---------- robots.txt ----------

interface RobotsRule {
  allow: boolean;
  path: string;
}

/** Rules that apply to us: a group naming "blackhole" if present, otherwise the "*" group. */
export function parseRobots(txt: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow') && val) current.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && 'blackhole'.includes(a)));
  return (mine ?? groups.find((g) => g.agents.includes('*')))?.rules ?? [];
}

/** Longest matching rule wins; Allow wins ties. Supports * and $. */
export function robotsAllows(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

async function robotsFor(origin: string): Promise<RobotsRule[]> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < DAY) return hit.rules;
  let rules: RobotsRule[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    // No robots.txt (4xx) means no restrictions; an unreachable one (5xx/network) is treated as "don't".
    if (res.status >= 500) rules = [{ allow: false, path: '/' }];
    else if (res.ok) rules = parseRobots((await res.text()).slice(0, 200_000));
  } catch {
    rules = [{ allow: false, path: '/' }];
  }
  robotsCache.set(origin, { rules, at: Date.now() });
  return rules;
}

// ---------- fetching ----------

const minGapMs = () => Number(process.env.SEARXNG_GAP_MS ?? 2500);
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

const looksLikeBotCheck = (status: number, body: string) =>
  [403, 429, 503].includes(status) || /cf-chl|challenge-platform|just a moment\.\.\.|attention required|captcha/i.test(body.slice(0, 20_000));

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/** Fetches one guide page's HTML. Throws PERMISSION_REQUIRED for disallowed hosts/paths or bot checks. */
export function fetchGuidePage(url: string): Promise<string> {
  const run = queue.then(async () => {
    const wait = lastAt + minGapMs() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fetchNow(url);
    } finally {
      lastAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

async function fetchNow(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !PAGE_HOSTS.has(u.hostname)) throw new AppError('PERMISSION_REQUIRED', `${u.hostname} is not an approved guide site`);
  if ((blockedUntil.get(u.hostname) ?? 0) > Date.now()) throw new AppError('PERMISSION_REQUIRED', `${u.hostname} shows a bot check to automated readers — open the guide link instead`);
  if (!robotsAllows(await robotsFor(u.origin), u.pathname)) throw new AppError('PERMISSION_REQUIRED', `${u.hostname}'s robots.txt does not allow reading this page`);
  let res: Response;
  try {
    res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(12_000), redirect: 'follow' });
  } catch {
    throw new AppError('SOURCE_UNAVAILABLE', `${u.hostname} could not be reached`);
  }
  const final = new URL(res.url || url);
  if (final.protocol !== 'https:' || !PAGE_HOSTS.has(final.hostname)) throw new AppError('PERMISSION_REQUIRED', 'Guide page redirected off the approved site');
  const body = await readCapped(res);
  if (looksLikeBotCheck(res.status, body)) {
    blockedUntil.set(u.hostname, Date.now() + DAY);
    throw new AppError('PERMISSION_REQUIRED', `${u.hostname} shows a bot check to automated readers — open the guide link instead`);
  }
  if (!res.ok) throw new AppError('SOURCE_UNAVAILABLE', `${u.hostname} returned HTTP ${res.status}`);
  return body;
}

// ---------- extraction ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr|ul|ol|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * The roadmap/overview box only: from the first labelled field to ~1500 chars later, cut at the comments section,
 * so reader comments further down the page can never supply values.
 */
export function roadmapBox(text: string): string | null {
  const start = text.search(/estimated\s+trophy\s+difficulty|approximate\s+(?:amount\s+of\s+)?time\s+to\s+(?:platinum|\/?\s*100)|minimum\s+(?:number\s+of\s+)?playthroughs/i);
  if (start < 0) return null;
  let box = text.slice(start, start + 1500);
  const cut = box.search(/\n\s*(?:\d+\s+)?(?:comments?|leave a (?:reply|comment)|related posts)\b/i);
  if (cut > 0) box = box.slice(0, cut);
  return box;
}
