import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../security/errors.js';
import { searxngUrl } from '../config.js';

// Adapters may only call these hosts (plus the local SearXNG origin). User/model-supplied URLs are never fetched.
const ALLOWED_HOSTS = new Set(['api.tvmaze.com', 'openlibrary.org', 'id.twitch.tv', 'api.igdb.com', 'api.themoviedb.org', 'datasets.imdbws.com']);

const isAllowed = (u: URL) => (u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname)) || u.origin === searxngUrl()?.origin;

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export async function fetchJson<T>(url: string, { timeoutMs = 8000, retries = 1, method = 'GET', headers = {}, body }: FetchOpts = {}): Promise<T> {
  const u = new URL(url);
  if (!isAllowed(u)) {
    throw new AppError('PERMISSION_REQUIRED', `Host ${u.hostname} is not an approved provider`);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(u, {
        method,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'Blackhole/0.1 (local personal media library)', ...headers },
        redirect: 'error',
      });
      if (res.status === 401 || res.status === 403) throw new AppError('PERMISSION_REQUIRED', `${u.hostname} rejected the credentials (HTTP ${res.status})`);
      if (res.status === 429) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new AppError('RATE_LIMITED', `${u.hostname} is rate limiting requests; try again shortly`);
      }
      if (res.status === 404) throw new AppError('NOT_FOUND', 'Not found at provider');
      if (!res.ok) throw new AppError('SOURCE_UNAVAILABLE', `${u.hostname} returned HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (attempt < retries) continue;
      throw new AppError('SOURCE_UNAVAILABLE', `${u.hostname} could not be reached (offline or timed out)`);
    }
  }
}

/**
 * Streams a provider file to disk via a temp file + rename, so a failed download never leaves a partial file.
 * With `ifModifiedSince`, an unchanged remote file returns false without downloading.
 */
export async function downloadFile(
  url: string,
  dest: string,
  { ifModifiedSince, timeoutMs = 300_000 }: { ifModifiedSince?: Date; timeoutMs?: number } = {},
): Promise<boolean> {
  const u = new URL(url);
  if (!isAllowed(u)) throw new AppError('PERMISSION_REQUIRED', `Host ${u.hostname} is not an approved provider`);
  let res: Response;
  try {
    res = await fetch(u, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Blackhole/0.1 (local personal media library)', ...(ifModifiedSince ? { 'If-Modified-Since': ifModifiedSince.toUTCString() } : {}) },
      redirect: 'error',
    });
  } catch {
    throw new AppError('SOURCE_UNAVAILABLE', `${u.hostname} could not be reached (offline or timed out)`);
  }
  if (res.status === 304) return false;
  if (!res.ok || !res.body) throw new AppError('SOURCE_UNAVAILABLE', `${u.hostname} returned HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  } catch {
    fs.rmSync(tmp, { force: true });
    throw new AppError('SOURCE_UNAVAILABLE', `Download from ${u.hostname} was interrupted`);
  }
  return true;
}

/** Provider text is untrusted: strip markup and collapse whitespace so it can only ever render as plain text. */
export function plainText(html: unknown, max = 4000): string | null {
  if (typeof html !== 'string') return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
}

/** Only keep https image URLs from known CDNs. */
export function safeImage(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' && u.hostname === 'static.tvmaze.com') u.protocol = 'https:';
    return u.protocol === 'https:' && ['static.tvmaze.com', 'covers.openlibrary.org', 'images.igdb.com', 'image.tmdb.org'].includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
