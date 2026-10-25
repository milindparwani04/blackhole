import { all, type DB } from '../db/db.js';
import { syncEpisodes } from '../adapters/tvmaze.js';
import { linkImdbId, syncImdbRatings } from '../adapters/imdb.js';
import { reconcileTv } from './library.js';
import { runMovieMaintenance } from './movies.js';

const STALE_MS = 20 * 60 * 60 * 1000;
// Shows whose IMDb link was already attempted this process, so a show TVmaze has no IMDb ID for isn't re-asked hourly.
const imdbTried = new Set<string>();

/**
 * D-04: keeps TV shows honest. Re-syncs TVmaze episode lists older than ~20h, then moves Completed shows with newly
 * aired unwatched episodes back to In progress. Runs at startup and hourly (also catches episodes whose air date
 * simply passed). Also links IMDb IDs so the ratings sync can match episodes. Provider failures are skipped; local
 * data is never removed by this job.
 */
export async function runTvMaintenance(db: DB, log: (msg: string) => void = () => {}): Promise<void> {
  const shows = all<{ entry_id: string; media_id: string; external_id: string | null; checked_at: string | null; imdb_id: string | null }>(
    db,
    `SELECT le.id AS entry_id, m.id AS media_id, x.external_id, m.checked_at, i.external_id AS imdb_id
     FROM library_entries le JOIN media_items m ON m.id = le.media_id
     LEFT JOIN external_ids x ON x.media_id = m.id AND x.provider = 'TVMAZE'
     LEFT JOIN external_ids i ON i.media_id = m.id AND i.provider = 'IMDB'
     WHERE m.type = 'TV' AND le.archived_at IS NULL AND le.status != 'DROPPED'`,
  );
  for (const s of shows) {
    if (s.external_id && (!s.checked_at || Date.now() - Date.parse(s.checked_at) > STALE_MS)) {
      try {
        await syncEpisodes(db, s.media_id, s.external_id);
      } catch {
        // Offline or rate-limited: try again next run.
      }
    }
    if (s.external_id && !s.imdb_id && !imdbTried.has(s.media_id)) {
      imdbTried.add(s.media_id);
      await linkImdbId(db, s.media_id, s.external_id).catch(() => imdbTried.delete(s.media_id));
    }
    if (reconcileTv(db, s.entry_id)) log(`TV: new episodes reopened entry ${s.entry_id}`);
  }
}

/** Hourly: TV upkeep, movie rating backfill, then one IMDb ratings pass (datasets re-downloaded at most daily). */
export async function runMaintenance(db: DB, dataDir: string, log: (msg: string) => void = () => {}): Promise<void> {
  await runTvMaintenance(db, log).catch(() => undefined);
  await runMovieMaintenance(db).catch(() => undefined);
  try {
    const { rated } = await syncImdbRatings(db, dataDir);
    if (rated) log(`IMDb: ${rated} ratings refreshed`);
  } catch {
    // IMDb datasets unreachable: keep the last ratings and retry next run.
  }
}

/** Starts the hourly job (first run after 5 s). Returns a function that stops it. */
export function scheduleTvMaintenance(db: DB, dataDir: string, log?: (msg: string) => void): () => void {
  const tick = () => void runMaintenance(db, dataDir, log).catch(() => undefined);
  const first = setTimeout(tick, 5_000);
  const hourly = setInterval(tick, 60 * 60 * 1000);
  return () => (clearTimeout(first), clearInterval(hourly));
}
