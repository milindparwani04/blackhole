import { all, get, nowIso, run, type DB } from '../db/db.js';
import { igdbConfigured } from '../config.js';
import { normalTimeToBeat } from '../adapters/igdb.js';
import { AppError } from '../security/errors.js';
import { defaultPlayPlatform, psPlatform } from './library.js';
import { runJob, startJob } from './trophies.js';

/** D-07: fills the NORMAL time from IGDB unless the user has entered their own value. Returns a status message. */
export async function refreshIgdbTime(db: DB, entryId: string): Promise<string> {
  const row = get<{ media_id: string; external_id: string | null }>(
    db,
    `SELECT le.media_id, x.external_id FROM library_entries le
     LEFT JOIN external_ids x ON x.media_id = le.media_id AND x.provider = 'IGDB' WHERE le.id = :id`,
    { id: entryId },
  );
  if (!row) throw new AppError('NOT_FOUND', 'Library entry not found');
  if (!row.external_id) throw new AppError('VALIDATION_ERROR', 'This game is not linked to IGDB');
  if (!igdbConfigured()) throw new AppError('PERMISSION_REQUIRED', 'IGDB keys are not set');
  const locked = get<{ user_locked: number }>(db, `SELECT user_locked FROM game_time_estimates WHERE media_id = :m AND category = 'NORMAL'`, { m: row.media_id });
  if (locked?.user_locked) return 'Kept your own normal time (IGDB value not applied)';
  const t = await normalTimeToBeat(row.external_id);
  if (!t) return 'IGDB has no time-to-beat submissions for this game yet';
  const slug = get<{ source_url: string | null }>(db, 'SELECT source_url FROM media_items WHERE id = :m', { m: row.media_id })?.source_url;
  run(
    db,
    `INSERT INTO game_time_estimates (media_id, category, hours, source, source_url, checked_at, user_locked)
     VALUES (:m, 'NORMAL', :hours, :source, :url, :now, 0)
     ON CONFLICT (media_id, category) DO UPDATE SET hours = excluded.hours, source = excluded.source,
       source_url = excluded.source_url, checked_at = excluded.checked_at
     WHERE game_time_estimates.user_locked = 0`,
    { m: row.media_id, hours: t.hours, source: `IGDB “normally” (${t.count} player${t.count === 1 ? '' : 's'})`, url: slug, now: nowIso() },
  );
  return `IGDB normal time: ${t.hours}h`;
}

/** Games added before D-05 have no play platform: give them the default (PS5 > PS4 > first). Only fills nulls. */
export function backfillPlayPlatforms(db: DB): number {
  const rows = all<{ id: string; platforms: string }>(
    db,
    `SELECT le.id, m.platforms FROM library_entries le JOIN media_items m ON m.id = le.media_id WHERE m.type = 'GAME' AND le.play_platform IS NULL`,
  );
  let n = 0;
  for (const r of rows) {
    const p = defaultPlayPlatform(JSON.parse(r.platforms) as string[]);
    if (p) n += Number(run(db, 'UPDATE library_entries SET play_platform = :p WHERE id = :id AND play_platform IS NULL', { p, id: r.id }).changes);
  }
  return n;
}

/** Starts a trophy lookup for the entry's play platform if it is PlayStation. Returns the job id, or null. */
export function queueTrophyLookup(db: DB, entryId: string, trigger: 'ADD' | 'REFRESH' | 'PLATFORM_CHANGE'): string | null {
  const e = get<{ play_platform: string | null }>(db, 'SELECT play_platform FROM library_entries WHERE id = :id', { id: entryId });
  const ps = psPlatform(e?.play_platform);
  return ps ? startJob(db, entryId, ps, trigger) : null;
}

/**
 * Runs after a game is saved. Failures are recorded on the job / ignored for playtime — the library entry is
 * already committed and never depends on enrichment (FR-01).
 */
export function enrichNewGame(db: DB, entryId: string, opts: { igdb: boolean }): void {
  const jobId = queueTrophyLookup(db, entryId, 'ADD');
  void (async () => {
    if (opts.igdb) await refreshIgdbTime(db, entryId).catch(() => undefined);
    if (jobId) await runJob(db, jobId).catch(() => undefined);
  })();
}
