import { searxngUrl } from '../config.js';
import { AppError } from '../security/errors.js';
import { fetchJson } from './http.js';

export interface SearxResult {
  url: string;
  title: string;
  content: string;
  engine?: string;
}

// Upstream engines throttle bursts (observed 2026-10-25: Brave/Google suspend ~180s, DuckDuckGo serves CAPTCHAs).
// Searches are serialised with a gap so normal use stays well under that; throttling is reported, never worked around.
const minGapMs = () => Number(process.env.SEARXNG_GAP_MS ?? 2500);
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

export function searx(q: string): Promise<SearxResult[]> {
  const next = queue.then(async () => {
    const wait = lastAt + minGapMs() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await searxNow(q);
    } finally {
      lastAt = Date.now();
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

export function resetSearxQueueForTests() {
  queue = Promise.resolve();
  lastAt = 0;
}

/** Queries the local SearXNG instance (JSON format must be enabled in its settings.yml). */
async function searxNow(q: string): Promise<SearxResult[]> {
  const base = searxngUrl();
  if (!base) throw new AppError('PERMISSION_REQUIRED', 'SEARXNG_URL must point at a SearXNG instance on this computer');
  const u = new URL('/search', base);
  u.search = new URLSearchParams({ q, format: 'json', language: 'en', safesearch: '0' }).toString();
  let data: { results?: SearxResult[]; unresponsive_engines?: [string, string][] };
  try {
    data = await fetchJson<typeof data>(u.toString(), { timeoutMs: 15000, retries: 0 });
  } catch (err) {
    if (err instanceof AppError && err.code === 'PERMISSION_REQUIRED') {
      throw new AppError('PERMISSION_REQUIRED', 'SearXNG refused JSON output — enable "json" under search.formats in its settings.yml');
    }
    throw new AppError('SOURCE_UNAVAILABLE', 'SearXNG is not running on this computer (start Docker Desktop / the blackhole-searxng container)');
  }
  const down = data.unresponsive_engines ?? [];
  if (!data.results?.length && down.length) {
    throw new AppError('RATE_LIMITED', `Search engines are temporarily limiting requests (${down.map(([e, why]) => `${e}: ${why}`).join('; ')}). Try Refresh again in a few minutes.`);
  }
  return (data.results ?? []).filter((r) => typeof r.url === 'string' && typeof r.title === 'string').map((r) => ({ ...r, content: String(r.content ?? '') }));
}

/** Cheap liveness probe of the local instance (SearXNG serves /healthz). */
export async function searxReachable(): Promise<boolean> {
  const base = searxngUrl();
  if (!base) return false;
  try {
    const r = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(1500), redirect: 'error' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function testSearx(): Promise<string> {
  const r = await searx('elden ring trophy guide');
  return `Connected — ${r.length} results for a sample query`;
}
