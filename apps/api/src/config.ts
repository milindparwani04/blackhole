import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// Provider credentials live in .env and never leave the server. The file is re-read when it changes,
// so keys pasted in while the server is running take effect without a restart.
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
let cache: { mtimeMs: number; values: Record<string, string | undefined> } | null = null;

function envFile(): Record<string, string | undefined> {
  // Tests set BLACKHOLE_ENV_FILE=off so real keys in .env are never used by the suite.
  if (process.env.BLACKHOLE_ENV_FILE === 'off') return {};
  try {
    const { mtimeMs } = fs.statSync(ENV_FILE);
    if (!cache || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, values: parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) };
    return cache.values;
  } catch {
    return {};
  }
}

// A blank value in .env falls through to the process environment.
const read = (name: string) => envFile()[name]?.trim() || process.env[name]?.trim() || null;

export const providerConfig = () => ({
  igdb: { clientId: read('IGDB_CLIENT_ID'), clientSecret: read('IGDB_CLIENT_SECRET') },
  tmdb: { token: read('TMDB_API_TOKEN') },
  searxng: { url: searxngUrl() },
});

export const igdbConfigured = () => {
  const c = providerConfig().igdb;
  return !!(c.clientId && c.clientSecret);
};
export const tmdbConfigured = () => !!providerConfig().tmdb.token;

/** SearXNG must run on this machine (D-01/D-02): only loopback URLs are accepted. */
export function searxngUrl(): URL | null {
  const raw = read('SEARXNG_URL') ?? 'http://127.0.0.1:8888';
  try {
    const u = new URL(raw);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && ['http:', 'https:'].includes(u.protocol) ? u : null;
  } catch {
    return null;
  }
}
