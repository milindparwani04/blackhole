import type { SearchResult } from '../../../../packages/shared/src/index.js';
import { all, get, nowIso, run, tx, uuid, type DB } from '../db/db.js';
import { fetchJson, plainText, safeImage } from './http.js';

const BASE = 'https://api.tvmaze.com';
export const TVMAZE_ATTRIBUTION = 'TV data from TVmaze.com, licensed CC BY-SA 4.0';

interface TvmazeShow {
  id: number;
  name: string;
  premiered: string | null;
  genres: string[];
  summary: string | null;
  averageRuntime: number | null;
  runtime: number | null;
  url: string;
  image: { medium?: string; original?: string } | null;
  network: { name: string } | null;
  webChannel: { name: string } | null;
}

interface TvmazeEpisode {
  id: number;
  season: number;
  number: number | null;
  name: string | null;
  airdate: string | null;
  runtime: number | null;
  summary: string | null;
  type: string;
}

export async function searchShows(q: string): Promise<SearchResult[]> {
  const hits = await fetchJson<{ show: TvmazeShow }[]>(`${BASE}/search/shows?q=${encodeURIComponent(q)}`);
  return hits.slice(0, 12).map(({ show }) => ({
    provider: 'TVMAZE',
    external_id: String(show.id),
    type: 'TV' as const,
    title: show.name,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    synopsis: plainText(show.summary),
    cover_url: safeImage(show.image?.medium),
    genres: show.genres ?? [],
    platforms: [],
    creator: show.network?.name ?? show.webChannel?.name ?? null,
    runtime_min: show.averageRuntime ?? show.runtime ?? null,
    source_url: show.url?.startsWith('https://www.tvmaze.com/') ? show.url : null,
    extra: show.network?.name ?? show.webChannel?.name ?? null,
    pages: null,
    already_in_pit: null,
  }));
}

/** The show's IMDb ID as TVmaze records it (used to match IMDb episode ratings), or null. */
export async function showImdbId(showId: string): Promise<string | null> {
  const show = await fetchJson<{ externals?: { imdb?: string | null } }>(`${BASE}/shows/${encodeURIComponent(showId)}`);
  const imdb = show.externals?.imdb;
  return typeof imdb === 'string' && /^tt\d{7,10}$/.test(imdb) ? imdb : null;
}

/**
 * Imports/refreshes seasons and episodes. Existing episodes keep their IDs (and so their watch state);
 * new episodes are added. TVmaze's episode ratings are not used: the heatmap reads IMDb only (D-03).
 */
export async function syncEpisodes(db: DB, mediaId: string, showId: string): Promise<{ episodes: number }> {
  const eps = await fetchJson<TvmazeEpisode[]>(`${BASE}/shows/${encodeURIComponent(showId)}/episodes?specials=1`);
  const now = nowIso();
  tx(db, () => {
    const specialCounter = new Map<number, number>();
    for (const ep of eps) {
      const isSpecial = ep.number == null || ep.type !== 'regular';
      const seasonNumber = isSpecial ? 0 : ep.season;
      let season = get<{ id: string }>(db, 'SELECT id FROM tv_seasons WHERE media_id = :m AND number = :n AND is_special = :s', {
        m: mediaId,
        n: seasonNumber,
        s: isSpecial ? 1 : 0,
      });
      if (!season) {
        season = { id: uuid() };
        run(db, 'INSERT INTO tv_seasons (id, media_id, number, is_special) VALUES (:id, :m, :n, :s)', {
          id: season.id,
          m: mediaId,
          n: seasonNumber,
          s: isSpecial ? 1 : 0,
        });
      }
      const number = isSpecial ? (specialCounter.set(0, (specialCounter.get(0) ?? 0) + 1), specialCounter.get(0)!) : ep.number!;
      const existing = get<{ id: string }>(db, `SELECT id FROM tv_episodes WHERE provider = 'TVMAZE' AND provider_id = :pid`, { pid: String(ep.id) });
      const episodeId = existing?.id ?? uuid();
      const fields = {
        id: episodeId,
        season_id: season.id,
        media_id: mediaId,
        pid: String(ep.id),
        number,
        title: plainText(ep.name, 300),
        airdate: ep.airdate || null,
        runtime_min: ep.runtime ?? null,
        summary: plainText(ep.summary),
      };
      if (existing) {
        run(
          db,
          `UPDATE tv_episodes SET season_id = :season_id, number = :number, title = :title, airdate = :airdate,
             runtime_min = :runtime_min, summary = :summary WHERE id = :id`,
          fields,
        );
      } else {
        run(
          db,
          `INSERT INTO tv_episodes (id, season_id, media_id, provider, provider_id, number, title, airdate, runtime_min, summary)
           VALUES (:id, :season_id, :media_id, 'TVMAZE', :pid, :number, :title, :airdate, :runtime_min, :summary)`,
          fields,
        );
      }
    }
    // Drop empty seasons left behind by renumbering.
    for (const s of all<{ id: string }>(db, 'SELECT id FROM tv_seasons WHERE media_id = :m', { m: mediaId })) {
      if (!get(db, 'SELECT 1 FROM tv_episodes WHERE season_id = :id', { id: s.id })) run(db, 'DELETE FROM tv_seasons WHERE id = :id', { id: s.id });
    }
    run(db, 'UPDATE media_items SET checked_at = :now WHERE id = :m', { now, m: mediaId });
  });
  return { episodes: eps.length };
}
