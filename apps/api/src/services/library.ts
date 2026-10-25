import type {
  BookEdition,
  EntryDetail,
  Episode,
  LibraryEntry,
  LibraryRow,
  MediaItem,
  MediaType,
  ProgressEvent,
  PsPlatform,
  Season,
  Status,
  TimeEstimate,
  TrophyGuide,
  TvProgress,
} from '../../../../packages/shared/src/index.js';
import { all, get, nowIso, run, tx, uuid, type DB } from '../db/db.js';
import { AppError } from '../security/errors.js';
import { latestJob } from './trophies.js';

const ENTRY_MUTABLE = [
  'status',
  'priority',
  'owned',
  'notes',
  'personal_rating',
  'current_page',
  'started_at',
  'completed_at',
  'story_completed_at',
  'platinum_earned_at',
  'archived_at',
  'play_platform',
] as const;
type EntryField = (typeof ENTRY_MUTABLE)[number];
export type EntryChanges = Partial<Pick<LibraryEntry, EntryField>>;

/** Local calendar date used for "released" checks; overridable in tests. */
export let todayLocal = () => new Date().toLocaleDateString('en-CA');
export function setTodayForTests(fn: () => string) {
  todayLocal = fn;
}

// ---------- row mapping ----------

const parseJson = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export function mapMedia(r: any): MediaItem {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    year: r.year ?? null,
    synopsis: r.synopsis ?? null,
    cover_url: r.cover_url ?? null,
    genres: parseJson(r.genres),
    platforms: parseJson(r.platforms),
    creator: r.creator ?? null,
    runtime_min: r.runtime_min ?? null,
    metadata_source: r.metadata_source,
    source_url: r.source_url ?? null,
    checked_at: r.checked_at ?? null,
  };
}

export function mapEntry(r: any): LibraryEntry {
  return {
    id: r.id,
    media_id: r.media_id,
    status: r.status,
    priority: r.priority,
    owned: !!r.owned,
    notes: r.notes,
    personal_rating: r.personal_rating ?? null,
    current_page: r.current_page ?? null,
    started_at: r.started_at ?? null,
    completed_at: r.completed_at ?? null,
    story_completed_at: r.story_completed_at ?? null,
    platinum_earned_at: r.platinum_earned_at ?? null,
    play_platform: r.play_platform ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    archived_at: r.archived_at ?? null,
    version: r.version,
  };
}

const nullableBool = (v: unknown) => (v === null || v === undefined ? null : !!v);

function mapTrophy(r: any): TrophyGuide {
  return {
    id: r.id,
    platform: r.platform,
    region: r.region,
    platinum: r.platinum,
    hours_min: r.hours_min ?? null,
    hours_max: r.hours_max ?? null,
    difficulty_min: r.difficulty_min ?? null,
    difficulty_max: r.difficulty_max ?? null,
    difficulty_text: r.difficulty_text ?? null,
    playthroughs: r.playthroughs ?? null,
    online_required: nullableBool(r.online_required),
    missables: nullableBool(r.missables),
    guide_url: r.guide_url ?? null,
    source: r.source ?? null,
    checked_at: r.checked_at ?? null,
    notes: r.notes,
    user_locked: !!r.user_locked,
  };
}

/** Maps provider platform labels (IGDB 'PS5', 'Vita', 'PlayStation 4'…) to a trophy platform, or null if not PlayStation. */
export function psPlatform(p: string | null | undefined): PsPlatform | null {
  const k = (p ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (/^(PS5|PLAYSTATION5)$/.test(k)) return 'PS5';
  if (/^(PS4|PLAYSTATION4)$/.test(k)) return 'PS4';
  if (/^(PS3|PLAYSTATION3)$/.test(k)) return 'PS3';
  if (/^(VITA|PSVITA|PLAYSTATIONVITA)$/.test(k)) return 'PSVITA';
  return null;
}

export const isPlayStation = (platforms: string[]) => platforms.some((p) => psPlatform(p) !== null);

/** D-05 default: PS5 if available (owner plays there ~90% of the time), else PS4, else the first listed platform. */
export function defaultPlayPlatform(platforms: string[]): string | null {
  return platforms.find((p) => psPlatform(p) === 'PS5') ?? platforms.find((p) => psPlatform(p) === 'PS4') ?? platforms.find((p) => psPlatform(p)) ?? platforms[0] ?? null;
}

// ---------- creation ----------

export interface NewMedia {
  type: MediaType;
  title: string;
  year?: number | null;
  synopsis?: string | null;
  cover_url?: string | null;
  genres?: string[];
  platforms?: string[];
  creator?: string | null;
  runtime_min?: number | null;
  metadata_source?: string;
  source_url?: string | null;
  external?: { provider: string; object_type: string; external_id: string } | null;
  pages?: number | null;
  pages_source?: string | null;
  isbn?: string | null;
  play_platform?: string | null;
}

/**
 * Add to the Pit: writes media + library entry in one transaction before any enrichment.
 * Provider-backed adds are idempotent on (provider, object_type, external_id).
 */
export function addToPit(db: DB, m: NewMedia): { entryId: string; duplicate: boolean } {
  return tx(db, () => {
    if (m.external) {
      const existing = get<{ entry_id: string }>(
        db,
        `SELECT le.id AS entry_id FROM external_ids x JOIN library_entries le ON le.media_id = x.media_id
         WHERE x.provider = :provider AND x.object_type = :object_type AND x.external_id = :external_id`,
        m.external,
      );
      if (existing) return { entryId: existing.entry_id, duplicate: true };
    }
    const mediaId = uuid();
    const entryId = uuid();
    const now = nowIso();
    run(
      db,
      `INSERT INTO media_items (id, type, title, year, synopsis, cover_url, genres, platforms, creator, runtime_min,
        metadata_source, source_url, checked_at, created_at)
       VALUES (:id, :type, :title, :year, :synopsis, :cover_url, :genres, :platforms, :creator, :runtime_min,
        :metadata_source, :source_url, :checked_at, :created_at)`,
      {
        id: mediaId,
        type: m.type,
        title: m.title.trim(),
        year: m.year,
        synopsis: m.synopsis,
        cover_url: m.cover_url,
        genres: JSON.stringify(m.genres ?? []),
        platforms: JSON.stringify(m.platforms ?? []),
        creator: m.creator,
        runtime_min: m.runtime_min,
        metadata_source: m.metadata_source ?? 'MANUAL',
        source_url: m.source_url,
        checked_at: m.external ? now : null,
        created_at: now,
      },
    );
    if (m.external) run(db, `INSERT INTO external_ids VALUES (:provider, :object_type, :external_id, :media_id)`, { ...m.external, media_id: mediaId });
    run(
      db,
      `INSERT INTO library_entries (id, media_id, play_platform, created_at, updated_at) VALUES (:id, :media_id, :play, :now, :now)`,
      { id: entryId, media_id: mediaId, now, play: m.type === 'GAME' ? (m.play_platform ?? defaultPlayPlatform(m.platforms ?? [])) : null },
    );
    if (m.type === 'BOOK') {
      run(db, `INSERT INTO book_editions (media_id, pages, isbn, pages_source) VALUES (:media_id, :pages, :isbn, :pages_source)`, {
        media_id: mediaId,
        pages: m.pages,
        isbn: m.isbn,
        pages_source: m.pages ? (m.pages_source ?? 'Manual entry') : null,
      });
    }
    recordEvent(db, entryId, 'ADDED', `Added to the Pit`, { entry_before: null });
    return { entryId, duplicate: false };
  });
}

/** Manual TV structure: one season per count, episodes numbered 1..n, no air dates (treated as released). */
export function createManualSeasons(db: DB, mediaId: string, counts: number[]) {
  tx(db, () => {
    counts.forEach((count, i) => {
      const seasonId = uuid();
      run(db, `INSERT INTO tv_seasons (id, media_id, number, is_special) VALUES (:id, :media_id, :number, 0)`, {
        id: seasonId,
        media_id: mediaId,
        number: i + 1,
      });
      for (let e = 1; e <= count; e++) {
        run(
          db,
          `INSERT INTO tv_episodes (id, season_id, media_id, provider, provider_id, number, airdate)
           VALUES (:id, :season_id, :media_id, 'MANUAL', :pid, :number, NULL)`,
          { id: uuid(), season_id: seasonId, media_id: mediaId, pid: `${mediaId}:${i + 1}:${e}`, number: e },
        );
      }
    });
  });
}

// ---------- events and undo ----------

function entryRow(db: DB, entryId: string) {
  const r = get<any>(db, 'SELECT * FROM library_entries WHERE id = :id', { id: entryId });
  if (!r) throw new AppError('NOT_FOUND', 'Library entry not found');
  return r;
}

function snapshot(r: any): Record<EntryField, unknown> {
  return Object.fromEntries(ENTRY_MUTABLE.map((k) => [k, r[k] ?? null])) as Record<EntryField, unknown>;
}

function recordEvent(db: DB, entryId: string, type: string, summary: string, payload: object, undoOf: string | null = null) {
  const id = uuid();
  run(
    db,
    `INSERT INTO progress_events (id, entry_id, event_type, summary, payload, occurred_at, undo_of)
     VALUES (:id, :entry_id, :type, :summary, :payload, :at, :undo_of)`,
    { id, entry_id: entryId, type, summary, payload: JSON.stringify(payload), at: nowIso(), undo_of: undoOf },
  );
  return id;
}

/**
 * Applies entry field changes as one undoable event. `expectedVersion` enables optimistic concurrency.
 */
export function mutateEntry(
  db: DB,
  entryId: string,
  type: string,
  summary: string,
  changes: EntryChanges,
  opts: { expectedVersion?: number; episodes?: { episode_id: string; watched: boolean; watched_at: string | null }[] } = {},
): string {
  return tx(db, () => {
    const before = entryRow(db, entryId);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== before.version) {
      throw new AppError('CONFLICT', 'This entry was changed elsewhere. Reload and try again.');
    }
    const fields = Object.keys(changes).filter((k) => (ENTRY_MUTABLE as readonly string[]).includes(k)) as EntryField[];
    if (fields.length) {
      const sets = fields.map((f) => `${f} = :${f}`).join(', ');
      run(db, `UPDATE library_entries SET ${sets}, updated_at = :now, version = version + 1 WHERE id = :id`, {
        ...changes,
        now: nowIso(),
        id: entryId,
      });
    } else {
      run(db, `UPDATE library_entries SET updated_at = :now, version = version + 1 WHERE id = :id`, { now: nowIso(), id: entryId });
    }
    let episodesBefore: unknown[] | undefined;
    if (opts.episodes?.length) {
      episodesBefore = opts.episodes.map(
        (e) =>
          get(db, 'SELECT episode_id, watched, watched_at FROM episode_watch_states WHERE entry_id = :entry_id AND episode_id = :episode_id', {
            entry_id: entryId,
            episode_id: e.episode_id,
          }) ?? { episode_id: e.episode_id, watched: null, watched_at: null },
      );
      for (const e of opts.episodes) writeEpisodeState(db, entryId, e.episode_id, e.watched ? 1 : 0, e.watched_at);
    }
    return recordEvent(db, entryId, type, summary, {
      entry_before: snapshot(before),
      entry_after: snapshot(entryRow(db, entryId)),
      episodes_before: episodesBefore,
    });
  });
}

function writeEpisodeState(db: DB, entryId: string, episodeId: string, watched: number | null, watchedAt: string | null) {
  if (watched === null) {
    run(db, 'DELETE FROM episode_watch_states WHERE entry_id = :entry_id AND episode_id = :episode_id', { entry_id: entryId, episode_id: episodeId });
    return;
  }
  run(
    db,
    `INSERT INTO episode_watch_states (entry_id, episode_id, watched, watched_at) VALUES (:entry_id, :episode_id, :watched, :watched_at)
     ON CONFLICT (entry_id, episode_id) DO UPDATE SET watched = excluded.watched, watched_at = excluded.watched_at`,
    { entry_id: entryId, episode_id: episodeId, watched, watched_at: watchedAt },
  );
}

/** Only the most recent active event per entry is undoable, so undo never clobbers later changes. */
function latestUndoableId(db: DB, entryId: string): string | null {
  const r = get<{ id: string }>(
    db,
    `SELECT id FROM progress_events WHERE entry_id = :id AND undone_at IS NULL AND event_type NOT IN ('ADDED','UNDO')
     ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
    { id: entryId },
  );
  return r?.id ?? null;
}

export function undoEvent(db: DB, eventId: string): string {
  return tx(db, () => {
    const ev = get<any>(db, 'SELECT * FROM progress_events WHERE id = :id', { id: eventId });
    if (!ev) throw new AppError('NOT_FOUND', 'Event not found');
    if (ev.undone_at) throw new AppError('CONFLICT', 'That change was already undone');
    if (latestUndoableId(db, ev.entry_id) !== eventId) {
      throw new AppError('CONFLICT', 'Only the most recent change can be undone');
    }
    const payload = JSON.parse(ev.payload);
    if (payload.entry_before) {
      const b = payload.entry_before as Record<string, unknown>;
      // Older snapshots may predate newer columns; only restore what was captured.
      const sets = ENTRY_MUTABLE.filter((f) => f in b).map((f) => `${f} = :${f}`).join(', ');
      run(db, `UPDATE library_entries SET ${sets}, updated_at = :now, version = version + 1 WHERE id = :id`, {
        ...b,
        now: nowIso(),
        id: ev.entry_id,
      });
    }
    for (const e of (payload.episodes_before ?? []) as any[]) {
      writeEpisodeState(db, ev.entry_id, e.episode_id, e.watched, e.watched_at);
    }
    run(db, 'UPDATE progress_events SET undone_at = :now WHERE id = :id', { now: nowIso(), id: eventId });
    recordEvent(db, ev.entry_id, 'UNDO', `Undid: ${ev.summary}`, {}, eventId);
    return ev.entry_id as string;
  });
}

// ---------- status helpers ----------

const STATUS_LABEL: Record<Status, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
};

export function statusChanges(current: any, status: Status): EntryChanges {
  const now = nowIso();
  const c: EntryChanges = { status };
  if (status === 'IN_PROGRESS' && !current.started_at) c.started_at = now;
  if (status === 'COMPLETED') c.completed_at = now;
  return c;
}

export function setStatus(db: DB, entryId: string, status: Status, expectedVersion?: number) {
  const cur = entryRow(db, entryId);
  if (cur.status === status) return null;
  return mutateEntry(db, entryId, 'STATUS', `Status → ${STATUS_LABEL[status]}`, statusChanges(cur, status), { expectedVersion });
}

export function getEntryVersion(db: DB, entryId: string) {
  return entryRow(db, entryId);
}

// ---------- TV ----------

export function loadSeasons(db: DB, mediaId: string, entryId: string): { seasons: Season[]; progress: TvProgress; ratings_attribution: string | null } {
  const today = todayLocal();
  const seasons = all<any>(db, 'SELECT * FROM tv_seasons WHERE media_id = :m ORDER BY is_special DESC, number', { m: mediaId });
  const eps = all<any>(
    db,
    `SELECT e.*, w.watched, w.watched_at, r.provider AS r_provider, r.score AS r_score, r.scale AS r_scale, r.fetched_at AS r_fetched
     FROM tv_episodes e
     LEFT JOIN episode_watch_states w ON w.episode_id = e.id AND w.entry_id = :entry
     LEFT JOIN episode_ratings r ON r.episode_id = e.id
     WHERE e.media_id = :m ORDER BY e.number`,
    { m: mediaId, entry: entryId },
  );
  const media = get<any>(db, 'SELECT runtime_min FROM media_items WHERE id = :m', { m: mediaId });
  const progress: TvProgress = {
    eligible: 0,
    watched: 0,
    specials_watched: 0,
    unreleased: 0,
    watched_minutes: 0,
    remaining_minutes: 0,
    runtime_estimated: false,
    suggest_complete: false,
  };
  const out: Season[] = seasons.map((s) => {
    const list: Episode[] = eps
      .filter((e) => e.season_id === s.id)
      .map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title ?? null,
        airdate: e.airdate ?? null,
        runtime_min: e.runtime_min ?? null,
        summary: e.summary ?? null,
        // Manual episodes have no air date and are treated as available; provider episodes need a past air date.
        released: e.provider === 'MANUAL' ? true : !!e.airdate && e.airdate <= today,
        watched: !!e.watched,
        watched_at: e.watched_at ?? null,
        rating: e.r_provider ? { provider: e.r_provider, score: e.r_score, scale: e.r_scale, fetched_at: e.r_fetched } : null,
      }));
    let eligible = 0;
    let watched = 0;
    for (const e of list) {
      if (!e.released) {
        progress.unreleased++;
        continue;
      }
      let mins = e.runtime_min;
      if (mins == null) {
        mins = media?.runtime_min ?? null;
        if (mins != null) progress.runtime_estimated = true;
      }
      if (s.is_special) {
        if (e.watched) progress.specials_watched++;
        continue;
      }
      eligible++;
      if (e.watched) {
        watched++;
        progress.watched_minutes += mins ?? 0;
      } else progress.remaining_minutes += mins ?? 0;
      if (mins == null) progress.runtime_estimated = true;
    }
    progress.eligible += eligible;
    progress.watched += watched;
    return { id: s.id, number: s.number, is_special: !!s.is_special, episodes: list, eligible, watched };
  });
  const entry = get<any>(db, 'SELECT status FROM library_entries WHERE id = :id', { id: entryId });
  // D-04 is unresolved: we only *suggest* completion, never auto-complete.
  // Kept for the case where a show was dropped/paused with everything watched; completion itself is automatic (D-04).
  progress.suggest_complete = progress.eligible > 0 && progress.watched === progress.eligible && !['COMPLETED', 'DROPPED'].includes(entry?.status);
  const rated = eps.find((e) => e.r_provider === 'TVMAZE');
  return { seasons: out, progress, ratings_attribution: rated ? 'Episode ratings: TVmaze user ratings (/10), CC BY-SA 4.0' : null };
}

export function setEpisodeWatched(db: DB, entryId: string, episodeId: string, watched: boolean) {
  const entry = entryRow(db, entryId);
  const ep = get<any>(
    db,
    `SELECT e.*, s.number AS season_number, s.is_special FROM tv_episodes e JOIN tv_seasons s ON s.id = e.season_id
     WHERE e.id = :id AND e.media_id = :m`,
    { id: episodeId, m: entry.media_id },
  );
  if (!ep) throw new AppError('NOT_FOUND', 'Episode not found for this show');
  const released = ep.provider === 'MANUAL' || (!!ep.airdate && ep.airdate <= todayLocal());
  if (watched && !released) throw new AppError('VALIDATION_ERROR', 'That episode has not aired yet');
  const label = ep.is_special ? `Special ${ep.number}` : `S${ep.season_number}E${ep.number}`;
  const episodes = [{ episode_id: episodeId, watched, watched_at: watched ? nowIso() : null }];
  const changes = tvStatusChanges(db, entry, episodes);
  return mutateEntry(db, entryId, 'EPISODE', `${label} ${watched ? 'watched' : 'unwatched'}${statusNote(changes)}`, changes, { episodes });
}

const statusNote = (c: EntryChanges) => (c.status === 'COMPLETED' ? ' · series completed' : c.status === 'IN_PROGRESS' ? ' · in progress' : '');

/**
 * D-04 (owner decision 2026-10-25): a show is Completed as soon as every aired regular episode is watched,
 * and returns to In progress if that stops being true. Applied in the same event as the watch change so one undo reverts both.
 */
function tvStatusChanges(db: DB, entry: any, deltas: { episode_id: string; watched: boolean }[]): EntryChanges {
  if (entry.status === 'DROPPED') return {};
  const { seasons } = loadSeasons(db, entry.media_id, entry.id);
  const delta = new Map(deltas.map((d) => [d.episode_id, d.watched]));
  let eligible = 0;
  let watched = 0;
  for (const s of seasons) {
    if (s.is_special) continue;
    for (const e of s.episodes) {
      if (!e.released) continue;
      eligible++;
      if (delta.get(e.id) ?? e.watched) watched++;
    }
  }
  if (eligible > 0 && watched === eligible) return entry.status === 'COMPLETED' ? {} : statusChanges(entry, 'COMPLETED');
  if (entry.status === 'COMPLETED') return statusChanges(entry, 'IN_PROGRESS');
  if (entry.status === 'PLANNED' && deltas.some((d) => d.watched)) return statusChanges(entry, 'IN_PROGRESS');
  return {};
}

/**
 * D-04: when episodes air after a show was completed, it goes back into the Pit (In progress).
 * Called after episode syncs and by the periodic TV job. Returns the event id when the status changed.
 */
export function reconcileTv(db: DB, entryId: string): string | null {
  const entry = entryRow(db, entryId);
  if (entry.status !== 'COMPLETED') return null;
  const since = String(entry.completed_at ?? '').slice(0, 10);
  const { seasons } = loadSeasons(db, entry.media_id, entryId);
  const fresh = seasons
    .filter((s) => !s.is_special)
    .flatMap((s) => s.episodes)
    .filter((e) => e.released && !e.watched && (!e.airdate || e.airdate >= since));
  if (!fresh.length) return null;
  return mutateEntry(db, entryId, 'NEW_EPISODES', `${fresh.length} new episode${fresh.length === 1 ? '' : 's'} aired — back in the Pit`, statusChanges(entry, 'IN_PROGRESS'));
}

/** Bulk-marks released episodes of a season (or every regular season) watched/unwatched. Specials and unreleased are skipped. */
export function setSeasonWatched(db: DB, entryId: string, seasonNumber: number | 'ALL', watched: boolean) {
  const entry = entryRow(db, entryId);
  const { seasons } = loadSeasons(db, entry.media_id, entryId);
  const targets = seasons.filter((s) => !s.is_special && (seasonNumber === 'ALL' || s.number === seasonNumber));
  if (!targets.length) throw new AppError('NOT_FOUND', 'Season not found');
  const now = nowIso();
  const episodes = targets
    .flatMap((s) => s.episodes)
    .filter((e) => e.released && e.watched !== watched)
    .map((e) => ({ episode_id: e.id, watched, watched_at: watched ? now : null }));
  if (!episodes.length) return null;
  const changes = tvStatusChanges(db, entry, episodes);
  const label = seasonNumber === 'ALL' ? 'All released episodes' : `Season ${seasonNumber}`;
  return mutateEntry(db, entryId, 'SEASON', `${label} marked ${watched ? 'watched' : 'unwatched'} (${episodes.length} episodes)${statusNote(changes)}`, changes, {
    episodes,
  });
}

// ---------- detail + list ----------

export function loadDetail(db: DB, entryId: string): EntryDetail {
  const e = entryRow(db, entryId);
  const m = get<any>(db, 'SELECT * FROM media_items WHERE id = :id', { id: e.media_id });
  const media = mapMedia(m);
  const undoable = latestUndoableId(db, entryId);
  const events: ProgressEvent[] = all<any>(
    db,
    'SELECT * FROM progress_events WHERE entry_id = :id ORDER BY occurred_at DESC, rowid DESC LIMIT 30',
    { id: entryId },
  ).map((r) => ({
    id: r.id,
    event_type: r.event_type,
    summary: r.summary,
    occurred_at: r.occurred_at,
    undone_at: r.undone_at ?? null,
    undoable: r.id === undoable,
  }));
  const detail: EntryDetail = { entry: mapEntry(e), media, events };
  if (media.type === 'GAME') {
    const times: TimeEstimate[] = all<any>(db, 'SELECT * FROM game_time_estimates WHERE media_id = :id', { id: media.id }).map((t) => ({
      category: t.category,
      hours: t.hours,
      source: t.source ?? null,
      source_url: t.source_url ?? null,
      checked_at: t.checked_at ?? null,
      user_locked: !!t.user_locked,
    }));
    const trophies = all<any>(db, 'SELECT * FROM trophy_guides WHERE media_id = :id ORDER BY platform DESC', { id: media.id }).map(mapTrophy);
    const playPs = psPlatform(e.play_platform);
    detail.game = {
      times,
      // D-05: only the stack for the version being played is relevant.
      trophies: trophies.filter((t) => t.platform === playPs),
      platinum_applicable: playPs !== null,
      play_ps: playPs,
      trophy_job: latestJob(db, entryId),
      igdb_linked: !!get(db, `SELECT 1 FROM external_ids WHERE media_id = :m AND provider = 'IGDB'`, { m: media.id }),
    };
  }
  if (media.type === 'TV') detail.tv = loadSeasons(db, media.id, entryId);
  if (media.type === 'BOOK') {
    const b = get<any>(db, 'SELECT * FROM book_editions WHERE media_id = :id', { id: media.id });
    const edition: BookEdition = { pages: b?.pages ?? null, isbn: b?.isbn ?? null, format: b?.format ?? null, pages_source: b?.pages_source ?? null };
    detail.book = { edition };
  }
  return detail;
}

export interface ListFilter {
  type?: MediaType;
  status?: Status;
  archived?: boolean;
  q?: string;
}

export function listEntries(db: DB, f: ListFilter): LibraryRow[] {
  const where = [f.archived ? 'le.archived_at IS NOT NULL' : 'le.archived_at IS NULL'];
  if (f.type) where.push('m.type = :type');
  if (f.status) where.push('le.status = :status');
  if (f.q) where.push(`m.title LIKE :q ESCAPE '\\'`);
  const rows = all<any>(
    db,
    `SELECT le.*, m.id AS m_id, m.type, m.title, m.year, m.synopsis, m.cover_url, m.genres, m.platforms, m.creator, m.runtime_min,
            m.metadata_source, m.source_url, m.checked_at,
            (SELECT hours FROM game_time_estimates g WHERE g.media_id = m.id AND g.category = 'NORMAL') AS normal_hours,
            b.pages AS pages
     FROM library_entries le JOIN media_items m ON m.id = le.media_id
     LEFT JOIN book_editions b ON b.media_id = m.id
     WHERE ${where.join(' AND ')}
     ORDER BY le.created_at DESC`,
    { type: f.type, status: f.status, q: f.q ? `%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : undefined },
  );
  const trophies = all<any>(db, 'SELECT * FROM trophy_guides ORDER BY platform DESC');
  const tvCounts = all<any>(
    db,
    `SELECT e.media_id, le.id AS entry_id,
       SUM(CASE WHEN s.is_special = 0 AND (e.provider = 'MANUAL' OR (e.airdate IS NOT NULL AND e.airdate <= :today)) THEN 1 ELSE 0 END) AS eligible,
       SUM(CASE WHEN s.is_special = 0 AND w.watched = 1 THEN 1 ELSE 0 END) AS watched,
       COUNT(DISTINCT CASE WHEN s.is_special = 0 THEN s.id END) AS seasons
     FROM tv_episodes e JOIN tv_seasons s ON s.id = e.season_id
     JOIN library_entries le ON le.media_id = e.media_id
     LEFT JOIN episode_watch_states w ON w.episode_id = e.id AND w.entry_id = le.id
     GROUP BY e.media_id`,
    { today: todayLocal() },
  );
  return rows.map((r) => {
    const media = mapMedia({ ...r, id: r.m_id });
    const entry = mapEntry(r);
    const ps = psPlatform(entry.play_platform);
    const t = trophies.find((x) => x.media_id === media.id && x.platform === ps && x.region === 'ALL');
    const tv = tvCounts.find((x) => x.media_id === media.id);
    return {
      entry,
      media,
      normal_hours: r.normal_hours ?? null,
      platinum_hours: t ? { min: t.hours_min ?? null, max: t.hours_max ?? null } : null,
      difficulty: t ? { min: t.difficulty_min ?? null, max: t.difficulty_max ?? null } : null,
      platinum: media.type !== 'GAME' ? null : t ? t.platinum : ps ? 'UNKNOWN' : 'NOT_APPLICABLE',
      tv: media.type === 'TV' ? { eligible: tv?.eligible ?? 0, watched: tv?.watched ?? 0, seasons: tv?.seasons ?? 0 } : null,
      pages: r.pages ?? null,
    };
  });
}

export function stats(db: DB) {
  const rows = all<any>(
    db,
    `SELECT m.type, COUNT(*) AS total, SUM(CASE WHEN le.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN le.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress
     FROM library_entries le JOIN media_items m ON m.id = le.media_id
     WHERE le.archived_at IS NULL GROUP BY m.type`,
  );
  const archived = get<any>(db, 'SELECT COUNT(*) AS n FROM library_entries WHERE archived_at IS NOT NULL')?.n ?? 0;
  const byType = Object.fromEntries(
    (['GAME', 'MOVIE', 'TV', 'BOOK'] as const).map((t) => {
      const r = rows.find((x) => x.type === t);
      return [t, { total: r?.total ?? 0, completed: r?.completed ?? 0, in_progress: r?.in_progress ?? 0 }];
    }),
  );
  return { byType, archived };
}
