import type { SearchResult } from '../../../../packages/shared/src/index.js';
import { providerConfig } from '../config.js';
import { AppError } from '../security/errors.js';
import { fetchJson, plainText, safeImage } from './http.js';

export const IGDB_ATTRIBUTION = 'Game data from IGDB.com (Twitch); free for non-commercial use';

interface IgdbGame {
  id: number;
  name: string;
  slug?: string;
  first_release_date?: number;
  summary?: string;
  cover?: { image_id: string };
  genres?: { name: string }[];
  platforms?: { abbreviation?: string; name: string }[];
  involved_companies?: { developer: boolean; company: { name: string } }[];
  category?: number;
  game_type?: number;
}

let token: { value: string; expiresAt: number } | null = null;

export function resetIgdbTokenForTests() {
  token = null;
}

async function accessToken(force = false): Promise<string> {
  const { clientId, clientSecret } = providerConfig().igdb;
  if (!clientId || !clientSecret) throw new AppError('PERMISSION_REQUIRED', 'IGDB is not configured (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)');
  if (!force && token && token.expiresAt > Date.now() + 60_000) return token.value;
  const qs = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const r = await fetchJson<{ access_token: string; expires_in: number }>(`https://id.twitch.tv/oauth2/token?${qs}`, { method: 'POST', retries: 0 });
  token = { value: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 };
  return token.value;
}

async function igdb<T>(endpoint: string, query: string): Promise<T> {
  const { clientId } = providerConfig().igdb;
  const call = async (t: string) =>
    fetchJson<T>(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      body: query,
      headers: { 'Client-ID': clientId!, Authorization: `Bearer ${t}`, 'Content-Type': 'text/plain' },
    });
  try {
    return await call(await accessToken());
  } catch (err) {
    // Token revoked or expired early: fetch a fresh one once.
    if (err instanceof AppError && err.code === 'PERMISSION_REQUIRED' && token) return call(await accessToken(true));
    throw err;
  }
}

/** Apicalypse strings use double quotes; strip characters that could break out of the search literal. */
const sanitize = (q: string) => q.replace(/["\\;]/g, ' ').trim();

export async function searchGames(q: string): Promise<SearchResult[]> {
  const games = await igdb<IgdbGame[]>(
    'games',
    `search "${sanitize(q)}"; fields name,slug,first_release_date,summary,cover.image_id,genres.name,platforms.abbreviation,platforms.name,involved_companies.developer,involved_companies.company.name; limit 15;`,
  );
  return games.map((g) => {
    const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
    const dev = g.involved_companies?.find((c) => c.developer)?.company.name ?? null;
    const platforms = (g.platforms ?? []).map((p) => p.abbreviation || p.name).filter(Boolean);
    return {
      provider: 'IGDB',
      external_id: String(g.id),
      type: 'GAME' as const,
      title: g.name,
      year,
      synopsis: plainText(g.summary),
      cover_url: g.cover ? safeImage(`https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`) : null,
      genres: (g.genres ?? []).map((x) => x.name).slice(0, 4),
      platforms,
      creator: dev,
      runtime_min: null,
      source_url: g.slug && /^[a-z0-9-]+$/.test(g.slug) ? `https://www.igdb.com/games/${g.slug}` : null,
      extra: platforms.join(', ') || null,
      pages: null,
      already_in_pit: null,
    };
  });
}

/**
 * D-07: IGDB's player-submitted "normally" time (seconds). Hastily/completely are deliberately not imported.
 * Returns null when IGDB has no submissions for the game.
 */
export async function normalTimeToBeat(gameId: string): Promise<{ hours: number; count: number } | null> {
  if (!/^\d+$/.test(gameId)) throw new AppError('VALIDATION_ERROR', 'Invalid IGDB id');
  const rows = await igdb<{ normally?: number; count?: number }[]>('game_time_to_beats', `fields normally,count; where game_id = ${gameId}; limit 1;`);
  const secs = rows[0]?.normally;
  if (!secs || secs <= 0) return null;
  // Half-hour precision: the underlying data is crowd-sourced, so more precision would be false.
  return { hours: Math.round((secs / 3600) * 2) / 2, count: rows[0]?.count ?? 0 };
}

/** Connectivity check for the Settings page. */
export async function testIgdb(): Promise<string> {
  await accessToken(true);
  const r = await igdb<IgdbGame[]>('games', 'fields name; where id = 1942; limit 1;');
  return `Connected — sample lookup returned “${r[0]?.name ?? 'no result'}”`;
}
