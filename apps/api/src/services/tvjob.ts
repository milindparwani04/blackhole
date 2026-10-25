import { all, type DB } from '../db/db.js';
import { syncEpisodes } from '../adapters/tvmaze.js';
import { reconcileTv } from './library.js';

const STALE_MS = 20 * 60 * 60 * 1000;

/**
 * D-04: keeps TV shows honest. Re-syncs TVmaze episode lists older than ~20h, then moves Completed shows with newly
 * aired unwatched episodes back to In progress. Runs at startup and hourly (also catches episodes whose air date
 * simply passed). Provider failures are skipped; local data is never removed by this job.
 */
export async function runTvMaintenance(db: DB, log: (msg: string) => void = () => {}): Promise<void> {
  const shows = all<{ entry_id: string; media_id: string; external_id: string | null; checked_at: string | null }>(
    db,
    `SELECT le.id AS entry_id, m.id AS media_id, x.external_id, m.checked_at
     FROM library_entries le JOIN media_items m ON m.id = le.media_id
     LEFT JOIN external_ids x ON x.media_id = m.id AND x.provider = 'TVMAZE'
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
    if (reconcileTv(db, s.entry_id)) log(`TV: new episodes reopened entry ${s.entry_id}`);
  }
}

export function scheduleTvMaintenance(db: DB, log?: (msg: string) => void) {
  const tick = () => void runTvMaintenance(db, log).catch(() => undefined);
  setTimeout(tick, 5_000);
  return setInterval(tick, 60 * 60 * 1000);
}
