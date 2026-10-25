import type { MediaRating, MovieRatings } from '../../../../packages/shared/src/index.js';
import { all, get, nowIso, run, type DB } from '../db/db.js';
import { IMDB_ATTRIBUTION, imdbTitleRating, storeImdbId, syncImdbRatings } from '../adapters/imdb.js';
import { RT_ATTRIBUTION, rtAudience, type RtAudience } from '../adapters/rottentomatoes.js';
import { movieDetail } from '../adapters/tmdb.js';
import { tmdbConfigured } from '../config.js';

const HOUR = 60 * 60 * 1000;
const RT_STALE_MS = 7 * 24 * HOUR;
/** Hourly backfill cap, so a big library never turns into a burst of page reads / searches. */
const RT_PER_RUN = 10;

// Recent RT lookups (title|year → result), so previewing in the Add dialog and then adding doesn't read the page twice.
const rtCache = new Map<string, { at: number; value: RtAudience | null }>();
async function rtCached(title: string, year: number | null): Promise<RtAudience | null> {
  const key = `${title}|${year ?? ''}`;
  const hit = rtCache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  const value = await rtAudience(title, year);
  rtCache.set(key, { at: Date.now(), value });
  return value;
}

export function resetMovieRatingStateForTests() {
  rtCache.clear();
  rtTried.clear();
  imdbTried.clear();
  pending.clear();
}

const toRating = (r: any): MediaRating => ({ score: r.score, scale: r.scale, votes: r.votes ?? null, label: r.label ?? null, url: r.url ?? null, fetched_at: r.fetched_at });

export function movieRatings(db: DB, mediaId: string): MovieRatings {
  const rows = all<any>(db, 'SELECT * FROM media_ratings WHERE media_id = :m', { m: mediaId });
  const imdb = rows.find((r) => r.provider === 'IMDB');
  const rt = rows.find((r) => r.provider === 'RT_AUDIENCE');
  return { imdb: imdb ? toRating(imdb) : null, rt_audience: rt ? toRating(rt) : null };
}

/** All movie ratings keyed by media id (for list views). */
export function allMovieRatings(db: DB): Map<string, MovieRatings> {
  const out = new Map<string, MovieRatings>();
  for (const r of all<any>(db, 'SELECT * FROM media_ratings')) {
    const cur = out.get(r.media_id) ?? { imdb: null, rt_audience: null };
    if (r.provider === 'IMDB') cur.imdb = toRating(r);
    if (r.provider === 'RT_AUDIENCE') cur.rt_audience = toRating(r);
    out.set(r.media_id, cur);
  }
  return out;
}

export const movieRatingAttribution = (r: MovieRatings) => [r.imdb ? `IMDb rating: ${IMDB_ATTRIBUTION}` : null, r.rt_audience ? RT_ATTRIBUTION : null].filter((x): x is string => !!x);

function saveRt(db: DB, mediaId: string, rt: RtAudience | null) {
  if (!rt) {
    run(db, `DELETE FROM media_ratings WHERE media_id = :m AND provider = 'RT_AUDIENCE'`, { m: mediaId });
    return;
  }
  run(
    db,
    `INSERT INTO media_ratings (media_id, provider, score, scale, votes, label, url, fetched_at) VALUES (:m, 'RT_AUDIENCE', :score, 100, NULL, :label, :url, :now)
     ON CONFLICT (media_id, provider) DO UPDATE SET score = excluded.score, label = excluded.label, url = excluded.url, fetched_at = excluded.fetched_at`,
    { m: mediaId, score: rt.score, label: rt.label, url: rt.url, now: nowIso() },
  );
}

// Background refreshes in flight, by media id, so the detail view can say ratings are on their way.
const pending = new Map<string, Promise<void>>();

/** Starts a ratings refresh without waiting for it (a new movie's ratings land a few seconds after it is added). */
export function refreshMovieRatingsInBackground(db: DB, dataDir: string, mediaId: string): Promise<void> {
  const running = pending.get(mediaId);
  if (running) return running;
  const p = refreshMovieRatings(db, dataDir, mediaId)
    .then(() => undefined, () => undefined)
    .finally(() => pending.delete(mediaId));
  pending.set(mediaId, p);
  return p;
}

export const movieRatingsPending = (mediaId: string) => pending.has(mediaId);

/** Resolves when this movie's background refresh (if any) has finished. */
export const movieRatingsSettled = (mediaId: string) => pending.get(mediaId) ?? Promise.resolve();

/**
 * Links the movie's IMDb ID (via TMDb) and refreshes its IMDb rating and RT audience score. Each source fails on its
 * own: a failure keeps that source's last value and is reported in `errors`.
 */
export async function refreshMovieRatings(db: DB, dataDir: string, mediaId: string): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const m = get<{ title: string; year: number | null }>(db, 'SELECT title, year FROM media_items WHERE id = :m', { m: mediaId });
  if (!m) return { errors };
  const tmdbId = get<{ external_id: string }>(db, `SELECT external_id FROM external_ids WHERE media_id = :m AND provider = 'TMDB'`, { m: mediaId })?.external_id;
  let imdb = get<{ external_id: string }>(db, `SELECT external_id FROM external_ids WHERE media_id = :m AND provider = 'IMDB'`, { m: mediaId })?.external_id ?? null;
  if (!imdb && tmdbId && tmdbConfigured()) {
    try {
      imdb = storeImdbId(db, mediaId, 'MOVIE', (await movieDetail(tmdbId)).imdb_id);
    } catch {
      errors.push('TMDb could not supply the IMDb ID');
    }
  }
  const tasks: Promise<unknown>[] = [];
  if (imdb) tasks.push(syncImdbRatings(db, dataDir, [mediaId]).catch(() => errors.push('IMDb ratings could not be downloaded')));
  tasks.push(
    rtCached(m.title, m.year)
      .then((rt) => saveRt(db, mediaId, rt))
      .catch((err) => errors.push(`Rotten Tomatoes: ${err?.message ?? 'page could not be read'}`)),
  );
  await Promise.all(tasks);
  return { errors };
}

/** Ratings for a TMDb search result before it is added (Add dialog). Nothing is stored. */
export async function previewMovieRatings(dataDir: string, tmdbId: string): Promise<MovieRatings> {
  const d = await movieDetail(tmdbId);
  const now = nowIso();
  const [imdb, rt] = await Promise.all([
    d.imdb_id ? imdbTitleRating(dataDir, d.imdb_id).catch(() => null) : null,
    rtCached(d.title, d.year).catch(() => null),
  ]);
  return {
    imdb: imdb && d.imdb_id ? { score: imdb.score, scale: 10, votes: imdb.votes, label: null, url: `https://www.imdb.com/title/${d.imdb_id}/`, fetched_at: now } : null,
    rt_audience: rt ? { score: rt.score, scale: 100, votes: null, label: rt.label, url: rt.url, fetched_at: now } : null,
  };
}

// Per-process memory of backfill attempts, so a movie with no IMDb ID / RT page isn't retried every hour.
const imdbTried = new Set<string>();
// RT attempts are timestamped so a long-running server still re-checks weekly.
const rtTried = new Map<string, number>();

/**
 * Hourly: links IMDb IDs for movies added before ratings existed and fills/refreshes RT audience scores older than a
 * week (at most RT_PER_RUN per run). IMDb movie ratings themselves are refreshed by the shared IMDb sync.
 */
export async function runMovieMaintenance(db: DB): Promise<void> {
  const movies = all<{ media_id: string; title: string; year: number | null; tmdb: string | null; imdb: string | null; rt_at: string | null }>(
    db,
    `SELECT m.id AS media_id, m.title, m.year, t.external_id AS tmdb, i.external_id AS imdb, r.fetched_at AS rt_at
     FROM library_entries le JOIN media_items m ON m.id = le.media_id
     LEFT JOIN external_ids t ON t.media_id = m.id AND t.provider = 'TMDB'
     LEFT JOIN external_ids i ON i.media_id = m.id AND i.provider = 'IMDB'
     LEFT JOIN media_ratings r ON r.media_id = m.id AND r.provider = 'RT_AUDIENCE'
     WHERE m.type = 'MOVIE' AND le.archived_at IS NULL`,
  );
  let rtBudget = RT_PER_RUN;
  for (const mv of movies) {
    if (!mv.imdb && mv.tmdb && tmdbConfigured() && !imdbTried.has(mv.media_id)) {
      imdbTried.add(mv.media_id);
      try {
        storeImdbId(db, mv.media_id, 'MOVIE', (await movieDetail(mv.tmdb)).imdb_id);
      } catch {
        imdbTried.delete(mv.media_id);
      }
    }
    const stale = !mv.rt_at || Date.now() - Date.parse(mv.rt_at) > RT_STALE_MS;
    if (stale && rtBudget > 0 && Date.now() - (rtTried.get(mv.media_id) ?? 0) > RT_STALE_MS) {
      rtBudget--;
      rtTried.set(mv.media_id, Date.now());
      try {
        saveRt(db, mv.media_id, await rtCached(mv.title, mv.year));
      } catch {
        // Unreachable / refused: keep the last value; retried in a week or via Refresh ratings.
      }
    }
  }
}
