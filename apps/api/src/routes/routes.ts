import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { MEDIA_TYPES, PS_PLATFORMS, STATUSES, TIME_CATEGORIES, type MutationResult, type SearchResponse } from '../../../../packages/shared/src/index.js';
import { all, get, nowIso, run, tx, uuid, type DB } from '../db/db.js';
import { AppError } from '../security/errors.js';
import { searchBooks, OPENLIBRARY_ATTRIBUTION } from '../adapters/openlibrary.js';
import { searchShows, syncEpisodes, TVMAZE_ATTRIBUTION } from '../adapters/tvmaze.js';
import { linkImdbId, storeImdbId, syncImdbRatings } from '../adapters/imdb.js';
import { previewMovieRatings, refreshMovieRatings } from '../services/movies.js';
import { IGDB_ATTRIBUTION, searchGames, testIgdb } from '../adapters/igdb.js';
import { movieDetail, searchMovies, testTmdb, TMDB_ATTRIBUTION } from '../adapters/tmdb.js';
import { igdbConfigured, searxngUrl, tmdbConfigured } from '../config.js';
import { searxReachable, testSearx } from '../adapters/searxng.js';
import { applyJob, revertJob, runJob } from '../services/trophies.js';
import { getImportJob, startGoodreadsPreview, startImport, startLetterboxdExportPreview, startLetterboxdPreview } from '../services/imports.js';
import { letterboxdUser } from '../adapters/letterboxd.js';
import { enrichNewGame, queueTrophyLookup, refreshIgdbTime } from '../services/games.js';
import {
  addToPit,
  createManualSeasons,
  getEntryVersion,
  isPlayStation,
  psPlatform,
  reconcileTv,
  listEntries,
  loadDetail,
  mutateEntry,
  setEpisodeWatched,
  setSeasonWatched,
  setStatus,
  stats,
  statusChanges,
  undoEvent,
  type EntryChanges,
} from '../services/library.js';

const httpsUrl = z
  .string()
  .max(2000)
  .refine((s) => {
    try {
      return new URL(s).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an https:// URL');
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const year = z.number().int().min(1800).max(2200).nullable().optional();

const AddBody = z.object({
  type: z.enum(MEDIA_TYPES),
  title: z.string().trim().min(1).max(300),
  year,
  synopsis: optText(4000),
  cover_url: httpsUrl.nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  platforms: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  creator: optText(200),
  runtime_min: z.number().int().min(1).max(100000).nullable().optional(),
  source_url: httpsUrl.nullable().optional(),
  pages: z.number().int().min(1).max(100000).nullable().optional(),
  isbn: optText(20),
  season_counts: z.array(z.number().int().min(1).max(500)).max(100).optional(),
  play_platform: z.string().trim().min(1).max(30).nullable().optional(),
  external: z
    .object({ provider: z.enum(['TVMAZE', 'OPENLIBRARY', 'IGDB', 'TMDB']), external_id: z.string().min(1).max(100) })
    .nullable()
    .optional(),
});

const PatchBody = z.object({
  version: z.number().int(),
  status: z.enum(STATUSES).optional(),
  priority: z.number().int().min(0).max(3).optional(),
  owned: z.boolean().optional(),
  notes: z.string().max(10000).optional(),
  personal_rating: z.number().min(0).max(10).nullable().optional(),
  current_page: z.number().int().min(0).max(100000).nullable().optional(),
});

const MediaPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  year,
  synopsis: optText(4000),
  cover_url: httpsUrl.nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  platforms: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  creator: optText(200),
  runtime_min: z.number().int().min(1).max(100000).nullable().optional(),
});

const TimeBody = z.object({
  category: z.enum(TIME_CATEGORIES),
  hours: z.number().min(0).max(10000).nullable(),
  source: optText(120),
  source_url: httpsUrl.nullable().optional(),
});

const TrophyBody = z
  .object({
    platform: z.enum(PS_PLATFORMS),
    region: z.string().trim().min(1).max(20).default('ALL'),
    platinum: z.enum(['YES', 'NO', 'UNKNOWN']),
    hours_min: z.number().min(0).max(10000).nullable().optional(),
    hours_max: z.number().min(0).max(10000).nullable().optional(),
    difficulty_min: z.number().min(0).max(10).nullable().optional(),
    difficulty_max: z.number().min(0).max(10).nullable().optional(),
    difficulty_text: optText(200),
    playthroughs: z.number().int().min(0).max(50).nullable().optional(),
    online_required: z.boolean().nullable().optional(),
    missables: z.boolean().nullable().optional(),
    guide_url: httpsUrl.nullable().optional(),
    source: optText(120),
    notes: z.string().max(4000).optional(),
  })
  .refine((t) => t.hours_min == null || t.hours_max == null || t.hours_min <= t.hours_max, 'Minimum hours exceed maximum')
  .refine((t) => t.difficulty_min == null || t.difficulty_max == null || t.difficulty_min <= t.difficulty_max, 'Minimum difficulty exceeds maximum');

const EditionBody = z.object({
  pages: z.number().int().min(1).max(100000).nullable(),
  isbn: optText(20),
  format: optText(40),
});

const idParam = z.object({ id: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AppError('VALIDATION_ERROR', `${issue.path.join('.') || 'request'}: ${issue.message}`);
  }
  return r.data;
}

export function registerRoutes(app: FastifyInstance, db: DB, opts: { dataDir: string; version: string }) {
  const result = (entryId: string, eventId: string | null): MutationResult => ({ detail: loadDetail(db, entryId), event_id: eventId });
  const mediaIdOf = (entryId: string) => getEntryVersion(db, entryId).media_id as string;
  const audit = (action: string, detail: object) =>
    run(db, 'INSERT INTO audit_events (id, at, action, detail) VALUES (:id, :at, :action, :detail)', {
      id: uuid(),
      at: nowIso(),
      action,
      detail: JSON.stringify(detail),
    });

  app.get('/api/health', async () => ({ ok: true, version: opts.version, host: '127.0.0.1', time: nowIso() }));

  app.get('/api/stats', async () => stats(db));

  // Registry rows overlaid with live configuration state. Only booleans are exposed — never key values.
  app.get('/api/providers', async () => {
    const searxUp = await searxReachable();
    return all<any>(db, 'SELECT * FROM provider_registry ORDER BY provider').map((p) => {
      if (p.provider === 'SEARXNG') {
        return searxUp
          ? { ...p, configured: true, permission_status: `ENABLED (local instance at ${searxngUrl()?.origin})` }
          : { ...p, configured: false, permission_status: `DISABLED: SearXNG not reachable at ${searxngUrl()?.origin ?? 'SEARXNG_URL (must be a loopback URL)'}` };
      }
      const configured = p.provider === 'IGDB' ? igdbConfigured() : p.provider === 'TMDB' ? tmdbConfigured() : null;
      if (configured === true) {
        return {
          ...p,
          configured,
          permission_status:
            p.provider === 'IGDB' ? 'ENABLED (credentials set; free non-commercial use)' : 'ENABLED (token set; non-commercial use with attribution)',
          attribution: p.provider === 'IGDB' ? IGDB_ATTRIBUTION : TMDB_ATTRIBUTION,
        };
      }
      return { ...p, configured };
    });
  });

  app.post('/api/providers/:provider/test', async (req) => {
    const { provider } = parse(z.object({ provider: z.enum(['IGDB', 'TMDB', 'SEARXNG']) }), req.params);
    try {
      const message = provider === 'IGDB' ? await testIgdb() : provider === 'TMDB' ? await testTmdb() : await testSearx();
      return { ok: true, message };
    } catch (err) {
      return { ok: false, message: err instanceof AppError ? err.message : 'Connection test failed' };
    }
  });

  app.get('/api/library', async (req) => {
    const q = parse(
      z.object({
        type: z.enum(MEDIA_TYPES).optional(),
        status: z.enum(STATUSES).optional(),
        archived: z.enum(['true', 'false']).optional(),
        q: z.string().max(200).optional(),
      }),
      req.query,
    );
    return listEntries(db, { type: q.type, status: q.status, archived: q.archived === 'true', q: q.q || undefined });
  });

  app.post('/api/library', async (req, reply) => {
    const b = parse(AddBody, req.body);
    const external = b.external ? { provider: b.external.provider, object_type: b.type, external_id: b.external.external_id } : null;
    const { entryId, duplicate } = addToPit(db, {
      ...b,
      metadata_source: external?.provider ?? 'MANUAL',
      external,
      pages_source: external?.provider === 'OPENLIBRARY' ? 'Open Library median across editions — check your edition' : 'Manual entry',
    });
    // Enrichment runs after the local save; failure never loses the entry.
    let enrichment_error: string | null = null;
    if (!duplicate && b.type === 'TV') {
      const mediaId = mediaIdOf(entryId);
      if (external) {
        try {
          await syncEpisodes(db, mediaId, external.external_id);
          // IMDb ratings can take a while on first use (dataset download); they land in the background.
          void linkImdbId(db, mediaId, external.external_id)
            .then((imdb) => (imdb ? syncImdbRatings(db, opts.dataDir, [mediaId]) : null))
            .catch(() => undefined);
        } catch (err) {
          enrichment_error = err instanceof AppError ? err.message : 'Episode import failed';
        }
      } else if (b.season_counts?.length) {
        createManualSeasons(db, mediaId, b.season_counts);
      }
    }
    if (!duplicate && b.type === 'MOVIE' && external?.provider === 'TMDB') {
      try {
        const m = await movieDetail(external.external_id);
        // Only fill gaps; never overwrite values the request already supplied.
        run(
          db,
          `UPDATE media_items SET runtime_min = COALESCE(runtime_min, :runtime), creator = COALESCE(creator, :director),
             genres = CASE WHEN genres = '[]' THEN :genres ELSE genres END, checked_at = :now WHERE id = :id`,
          { runtime: m.runtime_min, director: m.director, genres: JSON.stringify(m.genres), now: nowIso(), id: mediaIdOf(entryId) },
        );
        storeImdbId(db, mediaIdOf(entryId), 'MOVIE', m.imdb_id);
      } catch (err) {
        enrichment_error = err instanceof AppError ? err.message : 'Movie details could not be fetched';
      }
      // IMDb + RT audience usually take a few seconds; wait briefly so the new entry shows them, else they land later.
      const ratings = refreshMovieRatings(db, opts.dataDir, mediaIdOf(entryId)).catch(() => undefined);
      await Promise.race([ratings, new Promise((r) => setTimeout(r, 15_000))]);
    }
    if (!duplicate && b.type === 'GAME') enrichNewGame(db, entryId, { igdb: external?.provider === 'IGDB' });
    reply.code(duplicate ? 200 : 201);
    return { ...result(entryId, null), duplicate, enrichment_error };
  });

  app.get('/api/library/:id', async (req) => loadDetail(db, parse(idParam, req.params).id));

  // ---- one-off imports: preview (read + match, nothing written), then import what the owner kept ticked ----
  app.post('/api/import/letterboxd/preview', async (req, reply) => {
    const b = parse(z.object({ profile: z.string().min(1).max(300) }), req.body);
    reply.code(202);
    return startLetterboxdPreview(db, letterboxdUser(b.profile));
  });

  // Letterboxd export: the ZIP as base64, or the loose CSVs by file name.
  app.post('/api/import/letterboxd/export', { bodyLimit: 30 * 1024 * 1024 }, async (req, reply) => {
    const b = parse(
      z.union([z.object({ zip: z.string().min(1).max(28_000_000) }), z.object({ files: z.record(z.string().max(200), z.string().max(10_000_000)) })]),
      req.body,
    );
    reply.code(202);
    return startLetterboxdExportPreview(db, b);
  });

  app.post('/api/import/goodreads/preview', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const b = parse(z.object({ csv: z.string().min(1).max(10_000_000) }), req.body);
    reply.code(202);
    return startGoodreadsPreview(db, b.csv);
  });

  app.post('/api/import', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const Match = z
      .object({
        provider: z.enum(['TMDB', 'OPENLIBRARY']),
        external_id: z.string().max(40),
        title: z.string().min(1).max(500),
        year: z.number().int().nullable(),
        cover_url: z.string().regex(/^https:\/\/(image\.tmdb\.org|covers\.openlibrary\.org)\//).nullable(),
        synopsis: z.string().max(5000).nullable(),
        genres: z.array(z.string().max(100)).max(10),
      })
      .refine((m) => (m.provider === 'TMDB' ? /^\d+$/ : /^\/works\/OL\d+W$/).test(m.external_id), 'Invalid provider id');
    const Item = z
      .object({
        key: z.string().max(200),
        source: z.enum(['LETTERBOXD', 'GOODREADS']),
        type: z.enum(['MOVIE', 'BOOK']),
        title: z.string().min(1).max(500),
        year: z.number().int().min(-3000).max(2100).nullable(),
        creator: z.string().max(300).nullable(),
        rating: z.number().int().min(1).max(10).nullable(),
        status: z.enum(STATUSES),
        completed_at: z.string().datetime().nullable(),
        pages: z.number().int().min(1).max(50_000).nullable(),
        isbn: z.string().regex(/^[0-9X]{10}([0-9]{3})?$/i).nullable(),
        source_url: z.string().regex(/^https:\/\/(letterboxd\.com\/film\/[\w-]+\/|boxd\.it\/\w+|www\.goodreads\.com\/book\/show\/\d+)$/).nullable(),
        match: Match.nullable(),
        in_pit: z.string().nullable(),
      })
      .refine((i) => (i.type === 'MOVIE') === (i.source === 'LETTERBOXD') && (!i.match || (i.match.provider === 'TMDB') === (i.type === 'MOVIE')), 'Item type does not match its source');
    const b = parse(z.object({ items: z.array(Item).min(1).max(10_000) }), req.body);
    reply.code(202);
    return startImport(db, opts.dataDir, b.items);
  });

  app.get('/api/import/jobs/:id', async (req) => getImportJob(parse(idParam, req.params).id));

  app.patch('/api/library/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(PatchBody, req.body);
    const cur = getEntryVersion(db, id);
    const changes: EntryChanges = {};
    const parts: string[] = [];
    if (b.status && b.status !== cur.status) {
      Object.assign(changes, statusChanges(cur, b.status));
      parts.push(`status → ${b.status.replace('_', ' ').toLowerCase()}`);
    }
    if (b.priority !== undefined && b.priority !== cur.priority) (changes.priority = b.priority), parts.push(`priority ${b.priority}`);
    if (b.owned !== undefined && b.owned !== !!cur.owned) (changes.owned = b.owned), parts.push(b.owned ? 'owned' : 'not owned');
    if (b.notes !== undefined && b.notes !== cur.notes) (changes.notes = b.notes), parts.push('notes edited');
    if (b.personal_rating !== undefined && b.personal_rating !== cur.personal_rating) {
      changes.personal_rating = b.personal_rating;
      parts.push(b.personal_rating == null ? 'rating cleared' : `my rating ${b.personal_rating}/10`);
    }
    if (b.current_page !== undefined && b.current_page !== cur.current_page) {
      const pages = get<{ pages: number | null }>(db, 'SELECT pages FROM book_editions WHERE media_id = :m', { m: cur.media_id })?.pages;
      if (pages && b.current_page != null && b.current_page > pages) throw new AppError('VALIDATION_ERROR', `Page exceeds this edition's ${pages} pages`);
      changes.current_page = b.current_page;
      parts.push(`page ${b.current_page ?? '—'}`);
      if (b.current_page && cur.status === 'PLANNED' && !b.status) Object.assign(changes, statusChanges(cur, 'IN_PROGRESS'));
    }
    if (!parts.length) return result(id, null);
    const eventId = mutateEntry(db, id, b.status ? 'STATUS' : 'EDIT', parts.join(', ').replace(/^./, (c) => c.toUpperCase()), changes, {
      expectedVersion: b.version,
    });
    return result(id, eventId);
  });

  app.patch('/api/library/:id/media', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(MediaPatch, req.body);
    const mediaId = mediaIdOf(id);
    const cols = Object.keys(b) as (keyof typeof b)[];
    if (cols.length) {
      const vals: Record<string, unknown> = { ...b, id: mediaId };
      if (b.genres) vals.genres = JSON.stringify(b.genres);
      if (b.platforms) vals.platforms = JSON.stringify(b.platforms);
      run(db, `UPDATE media_items SET ${cols.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`, vals);
    }
    return result(id, null);
  });

  app.post('/api/library/:id/complete', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ kind: z.enum(['STORY', 'PLATINUM', 'WATCHED', 'FINISHED', 'SERIES']), done: z.boolean() }), req.body);
    const cur = getEntryVersion(db, id);
    const detail = loadDetail(db, id);
    const type = detail.media.type;
    const now = nowIso();
    const changes: EntryChanges = {};
    let summary: string;
    switch (b.kind) {
      case 'STORY':
        if (type !== 'GAME') throw new AppError('VALIDATION_ERROR', 'Story completion applies to games');
        changes.story_completed_at = b.done ? now : null;
        if (b.done && cur.status !== 'COMPLETED') Object.assign(changes, statusChanges(cur, 'COMPLETED'));
        summary = b.done ? 'Story completed' : 'Story completion cleared';
        break;
      case 'PLATINUM':
        if (type !== 'GAME' || !detail.game?.platinum_applicable) throw new AppError('VALIDATION_ERROR', 'Platinum applies to PlayStation games only');
        // Deliberately independent of story completion.
        changes.platinum_earned_at = b.done ? now : null;
        summary = b.done ? 'Platinum earned' : 'Platinum cleared';
        break;
      case 'WATCHED':
        if (type !== 'MOVIE') throw new AppError('VALIDATION_ERROR', 'Mark watched applies to movies');
        Object.assign(changes, statusChanges(cur, b.done ? 'COMPLETED' : 'PLANNED'));
        summary = b.done ? 'Marked watched' : 'Marked unwatched';
        break;
      case 'FINISHED': {
        if (type !== 'BOOK') throw new AppError('VALIDATION_ERROR', 'Mark finished applies to books');
        Object.assign(changes, statusChanges(cur, b.done ? 'COMPLETED' : 'IN_PROGRESS'));
        if (b.done && detail.book?.edition.pages) changes.current_page = detail.book.edition.pages;
        summary = b.done ? 'Finished reading' : 'Reopened';
        break;
      }
      case 'SERIES':
        if (type !== 'TV') throw new AppError('VALIDATION_ERROR', 'Series completion applies to TV');
        Object.assign(changes, statusChanges(cur, b.done ? 'COMPLETED' : 'IN_PROGRESS'));
        summary = b.done ? 'Series marked completed' : 'Series reopened';
        break;
    }
    return result(id, mutateEntry(db, id, 'COMPLETE', summary, changes));
  });

  app.post('/api/library/:id/status', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ status: z.enum(STATUSES), version: z.number().int().optional() }), req.body);
    return result(id, setStatus(db, id, b.status, b.version));
  });

  app.post('/api/library/:id/archive', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ archived: z.boolean() }), req.body);
    const eventId = mutateEntry(db, id, 'ARCHIVE', b.archived ? 'Archived' : 'Restored from archive', { archived_at: b.archived ? nowIso() : null });
    return result(id, eventId);
  });

  // "Remove from Pit": permanent, from the backlog or the archive (owner, 25/10/2026: no type-the-title step).
  app.delete('/api/library/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const d = loadDetail(db, id);
    run(db, 'DELETE FROM media_items WHERE id = :id', { id: d.media.id });
    audit('PERMANENT_DELETE', { title: d.media.title, type: d.media.type });
    return { deleted: true };
  });

  app.post('/api/events/:id/undo', async (req) => {
    const { id } = parse(idParam, req.params);
    return result(undoEvent(db, id), null);
  });

  // ---------- games ----------

  app.put('/api/games/:id/times', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(TimeBody, req.body);
    const mediaId = mediaIdOf(id);
    if (b.hours == null) {
      run(db, 'DELETE FROM game_time_estimates WHERE media_id = :m AND category = :c', { m: mediaId, c: b.category });
    } else {
      run(
        db,
        `INSERT INTO game_time_estimates (media_id, category, hours, source, source_url, checked_at, user_locked)
         VALUES (:m, :c, :hours, :source, :source_url, :now, 1)
         ON CONFLICT (media_id, category) DO UPDATE SET hours = excluded.hours, source = excluded.source,
           source_url = excluded.source_url, checked_at = excluded.checked_at, user_locked = 1`,
        { m: mediaId, c: b.category, hours: b.hours, source: b.source || 'Manual entry', source_url: b.source_url, now: nowIso() },
      );
    }
    return result(id, null);
  });

  app.put('/api/games/:id/trophies', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(TrophyBody, req.body);
    const mediaId = mediaIdOf(id);
    const platforms = loadDetail(db, id).media.platforms;
    if (!isPlayStation(platforms)) throw new AppError('VALIDATION_ERROR', 'Add a PlayStation platform to this game before recording a trophy stack');
    run(
      db,
      `INSERT INTO trophy_guides (id, media_id, platform, region, platinum, hours_min, hours_max, difficulty_min, difficulty_max,
         difficulty_text, playthroughs, online_required, missables, guide_url, source, checked_at, notes, user_locked)
       VALUES (:id, :m, :platform, :region, :platinum, :hours_min, :hours_max, :difficulty_min, :difficulty_max,
         :difficulty_text, :playthroughs, :online_required, :missables, :guide_url, :source, :now, :notes, 1)
       ON CONFLICT (media_id, platform, region) DO UPDATE SET platinum = excluded.platinum, hours_min = excluded.hours_min,
         hours_max = excluded.hours_max, difficulty_min = excluded.difficulty_min, difficulty_max = excluded.difficulty_max,
         difficulty_text = excluded.difficulty_text, playthroughs = excluded.playthroughs, online_required = excluded.online_required,
         missables = excluded.missables, guide_url = excluded.guide_url, source = excluded.source, checked_at = excluded.checked_at,
         notes = excluded.notes, user_locked = 1`,
      { ...b, id: uuid(), m: mediaId, now: nowIso(), notes: b.notes ?? '', source: b.source || 'Manual entry' },
    );
    return result(id, null);
  });

  app.delete('/api/games/:id/trophies/:trophyId', async (req) => {
    const { id, trophyId } = parse(z.object({ id: z.string().uuid(), trophyId: z.string().uuid() }), req.params);
    run(db, 'DELETE FROM trophy_guides WHERE id = :t AND media_id = :m', { t: trophyId, m: mediaIdOf(id) });
    return result(id, null);
  });

  // FR-05: refresh never auto-applies; it returns a proposal the user reviews against the current values.
  app.post('/api/games/:id/trophy-refresh', async (req) => {
    const { id } = parse(idParam, req.params);
    const jobId = queueTrophyLookup(db, id, 'REFRESH');
    if (!jobId) throw new AppError('VALIDATION_ERROR', 'Trophies apply only when you are playing on a PlayStation platform');
    await runJob(db, jobId);
    return result(id, null);
  });

  app.post('/api/trophy-jobs/:id/apply', async (req) => {
    const { id } = parse(idParam, req.params);
    return result(applyJob(db, id), null);
  });

  app.post('/api/trophy-jobs/:id/revert', async (req) => {
    const { id } = parse(idParam, req.params);
    return result(revertJob(db, id), null);
  });

  app.post('/api/library/:id/play-platform', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ platform: z.string().trim().min(1).max(30) }), req.body);
    const d = loadDetail(db, id);
    if (d.media.type !== 'GAME') throw new AppError('VALIDATION_ERROR', 'Only games have a play platform');
    if (!d.media.platforms.includes(b.platform)) throw new AppError('VALIDATION_ERROR', `${b.platform} is not one of this game's platforms`);
    if (d.entry.play_platform === b.platform) return result(id, null);
    const eventId = mutateEntry(db, id, 'PLATFORM', `Playing on ${b.platform}`, { play_platform: b.platform });
    // Look up the new version's trophies unless that stack is already recorded.
    const ps = psPlatform(b.platform);
    const hasStack = ps && get(db, `SELECT 1 FROM trophy_guides WHERE media_id = :m AND platform = :p`, { m: d.media.id, p: ps });
    if (ps && !hasStack) {
      const jobId = queueTrophyLookup(db, id, 'PLATFORM_CHANGE');
      if (jobId) void runJob(db, jobId).catch(() => undefined);
    }
    return result(id, eventId);
  });

  app.post('/api/games/:id/igdb-time', async (req) => {
    const { id } = parse(idParam, req.params);
    const message = await refreshIgdbTime(db, id);
    return { ...result(id, null), message };
  });

  // ---------- tv ----------

  app.post('/api/tv/:id/episodes/:episodeId/watch', async (req) => {
    const { id, episodeId } = parse(z.object({ id: z.string().uuid(), episodeId: z.string().uuid() }), req.params);
    const b = parse(z.object({ watched: z.boolean() }), req.body);
    return result(id, setEpisodeWatched(db, id, episodeId, b.watched));
  });

  app.post('/api/tv/:id/seasons/:num/watch', async (req) => {
    const { id, num } = parse(z.object({ id: z.string().uuid(), num: z.union([z.literal('all'), z.coerce.number().int().min(1)]) }), req.params);
    const b = parse(z.object({ watched: z.boolean() }), req.body);
    return result(id, setSeasonWatched(db, id, num === 'all' ? 'ALL' : num, b.watched));
  });

  app.post('/api/tv/:id/sync', async (req) => {
    const { id } = parse(idParam, req.params);
    const mediaId = mediaIdOf(id);
    const ext = get<{ external_id: string }>(db, `SELECT external_id FROM external_ids WHERE media_id = :m AND provider = 'TVMAZE'`, { m: mediaId });
    if (!ext) throw new AppError('VALIDATION_ERROR', 'This show was added manually and has no TVmaze link');
    await syncEpisodes(db, mediaId, ext.external_id);
    try {
      if (await linkImdbId(db, mediaId, ext.external_id)) await syncImdbRatings(db, opts.dataDir, [mediaId]);
    } catch {
      // IMDb unreachable: the episode refresh still stands and the last ratings are kept.
    }
    return result(id, reconcileTv(db, id));
  });

  // ---------- movies ----------

  app.post('/api/movies/:id/ratings/refresh', async (req) => {
    const { id } = parse(idParam, req.params);
    const { errors } = await refreshMovieRatings(db, opts.dataDir, mediaIdOf(id));
    return { ...result(id, null), errors };
  });

  // Add dialog: ratings for a TMDb result before it is added. Nothing is stored.
  app.get('/api/movies/preview-ratings', async (req) => {
    const { tmdb } = parse(z.object({ tmdb: z.string().regex(/^\d{1,10}$/) }), req.query);
    return previewMovieRatings(opts.dataDir, tmdb);
  });

  // ---------- books ----------

  app.put('/api/books/:id/edition', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(EditionBody, req.body);
    run(
      db,
      `INSERT INTO book_editions (media_id, pages, isbn, format, pages_source) VALUES (:m, :pages, :isbn, :format, 'Manual entry')
       ON CONFLICT (media_id) DO UPDATE SET pages = excluded.pages, isbn = excluded.isbn, format = excluded.format, pages_source = 'Manual entry'`,
      { ...b, m: mediaIdOf(id) },
    );
    return result(id, null);
  });

  // ---------- search ----------

  app.get('/api/search', async (req): Promise<SearchResponse> => {
    const q = parse(z.object({ type: z.enum(MEDIA_TYPES), q: z.string().trim().min(2).max(120) }), req.query);
    const notConfigured = (provider: string, message: string): SearchResponse => ({
      provider,
      provider_status: 'NOT_CONFIGURED',
      message,
      attribution: null,
      results: [],
    });
    if (q.type === 'GAME' && !igdbConfigured())
      return notConfigured('IGDB', 'Game search needs IGDB credentials (see Data & Sources → Set up API keys). Add the game manually below.');
    if (q.type === 'MOVIE' && !tmdbConfigured())
      return notConfigured('TMDB', 'Movie search needs a TMDb token (see Data & Sources → Set up API keys). Add the movie manually below.');
    const SEARCH = {
      GAME: { provider: 'IGDB', run: searchGames, attribution: IGDB_ATTRIBUTION },
      MOVIE: { provider: 'TMDB', run: searchMovies, attribution: TMDB_ATTRIBUTION },
      TV: { provider: 'TVMAZE', run: searchShows, attribution: TVMAZE_ATTRIBUTION },
      BOOK: { provider: 'OPENLIBRARY', run: searchBooks, attribution: OPENLIBRARY_ATTRIBUTION },
    }[q.type];
    const provider = SEARCH.provider;
    try {
      const results = await SEARCH.run(q.q);
      for (const r of results) {
        r.already_in_pit =
          get<{ id: string }>(
            db,
            `SELECT le.id FROM external_ids x JOIN library_entries le ON le.media_id = x.media_id
             WHERE x.provider = :p AND x.object_type = :t AND x.external_id = :e`,
            { p: provider, t: q.type, e: r.external_id },
          )?.id ?? null;
      }
      return { provider, provider_status: 'OK', message: null, attribution: SEARCH.attribution, results };
    } catch (err) {
      return { provider, provider_status: 'ERROR', message: err instanceof AppError ? err.message : 'Search failed', attribution: null, results: [] };
    }
  });

  // ---------- data ----------

  app.post('/api/backup', async () => {
    const dir = path.join(opts.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `blackhole-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit('BACKUP', { file: path.basename(file) });
    return { file, bytes: fs.statSync(file).size, created_at: nowIso() };
  });

  app.get('/api/backups', async () => {
    const dir = path.join(opts.dataDir, 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => b.file.localeCompare(a.file));
  });

  app.get('/api/export', async (_req, reply) => {
    const tables = [
      'media_items',
      'external_ids',
      'library_entries',
      'progress_events',
      'game_time_estimates',
      'trophy_guides',
      'tv_seasons',
      'tv_episodes',
      'episode_watch_states',
      'episode_ratings',
      'media_ratings',
      'book_editions',
    ];
    const schema = get<{ v: number }>(db, 'SELECT MAX(version) AS v FROM schema_migrations')?.v;
    const data = tx(db, () => Object.fromEntries(tables.map((t) => [t, all(db, `SELECT * FROM ${t}`)])));
    reply.header('Content-Disposition', `attachment; filename="blackhole-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return { format: 'blackhole-export', schema_version: schema, exported_at: nowIso(), app_version: opts.version, data };
  });
}
