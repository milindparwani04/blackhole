import type { ImportItem, ImportJob, MediaType, SearchResult } from '../../../../packages/shared/src/index.js';
import { get, nowIso, run, uuid, type DB } from '../db/db.js';
import { AppError } from '../security/errors.js';
import { parseLetterboxdExport, readLetterboxdProfile, unzipText, type LetterboxdFilm } from '../adapters/letterboxd.js';
import { parseGoodreadsCsv, stripSeries } from '../adapters/goodreads.js';
import { movieDetail, searchMovies } from '../adapters/tmdb.js';
import { searchBooks } from '../adapters/openlibrary.js';
import { storeImdbId, syncImdbRatings } from '../adapters/imdb.js';
import { anilistDate, anilistRating, anilistStatus, fetchAnilistMedia, type AnilistListEntry } from '../adapters/anilist.js';
import { tmdbConfigured } from '../config.js';
import { addToPit, createManualSeasons } from './library.js';

/**
 * One-off imports (owner, 25/10/2026; revises D-06): Letterboxd films/watchlist read from the public profile, and
 * Goodreads books from the owner's CSV export; AniList anime (into TV) from its GDPR data export. Two background jobs the UI polls: PREVIEW reads the source and matches
 * each title (TMDb for films, Open Library for books) without writing anything; IMPORT adds what the owner kept ticked.
 * Status, rating and finish date come from the source; a missing finish date stays empty rather than guessed.
 * Titles already in the Pit are never changed.
 */
const GAP_MS = () => Number(process.env.IMPORT_GAP_MS ?? 150);
const jobs = new Map<string, ImportJob>();

export function resetImportsForTests() {
  jobs.clear();
}

export function getImportJob(id: string): ImportJob {
  const j = jobs.get(id);
  if (!j) throw new AppError('NOT_FOUND', 'Import job not found');
  return j;
}

function startJob(kind: ImportJob['kind'], work: (job: ImportJob) => Promise<void>): ImportJob {
  if ([...jobs.values()].some((j) => !j.finished)) throw new AppError('CONFLICT', 'An import is already running');
  const job: ImportJob = { id: uuid(), kind, phase: 'Starting…', done: 0, total: 0, finished: false, error: null, notice: null, items: null, result: null };
  jobs.set(job.id, job);
  work(job)
    .catch((err) => (job.error = err instanceof AppError ? err.message : 'Import failed'))
    .finally(() => (job.finished = true));
  return job;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const normTitle = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Best TMDb result for a film: same year (±1) required when the year is known; exact title preferred. */
export function pickMatch(film: { title: string; year: number | null }, results: SearchResult[]): SearchResult | null {
  const want = normTitle(film.title);
  const near = film.year == null ? results : results.filter((r) => r.year != null && Math.abs(r.year - film.year!) <= 1);
  const sameTitle = (r: SearchResult) => normTitle(r.title) === want || (r.extra != null && normTitle(r.extra) === want);
  return near.find((r) => sameTitle(r) && r.year === film.year) ?? near.find(sameTitle) ?? (film.year != null ? (near[0] ?? null) : null);
}

const sameAuthor = (author: string | null, creator: string | null) => {
  const surname =
    normTitle(author ?? '')
      .split(' ')
      .pop() ?? '';
  return !surname || normTitle(creator ?? '').includes(surname);
};

/** Best Open Library work for a title+author search: the author must match and the titles must overlap. */
export function pickBook(book: { title: string; author: string | null }, results: SearchResult[]): SearchResult | null {
  const t = normTitle(stripSeries(book.title));
  return (
    results.find((r) => {
      const rt = normTitle(r.title);
      return sameAuthor(book.author, r.creator) && rt.length > 0 && (rt === t || t.includes(rt) || rt.includes(t));
    }) ?? null
  );
}

const toMatch = (r: SearchResult): NonNullable<ImportItem['match']> => ({
  provider: r.provider as 'TMDB' | 'OPENLIBRARY' | 'ANILIST',
  external_id: r.external_id,
  title: r.title,
  year: r.year,
  cover_url: r.cover_url,
  synopsis: r.synopsis,
  genres: r.genres,
});

function inPit(db: DB, type: MediaType, match: ImportItem['match'], titles: string[], year: number | null): string | null {
  if (match) {
    const hit = get<{ id: string }>(
      db,
      `SELECT le.id FROM external_ids x JOIN library_entries le ON le.media_id = x.media_id WHERE x.provider = :p AND x.object_type = :t AND x.external_id = :id`,
      { p: match.provider, t: type, id: match.external_id },
    );
    if (hit) return hit.id;
  }
  // Same type + title (+ year, for films) under any of its names counts as the same title.
  for (const title of titles) {
    const hit = get<{ id: string }>(
      db,
      `SELECT le.id FROM media_items m JOIN library_entries le ON le.media_id = m.id
       WHERE m.type = :type AND lower(m.title) = lower(:title) AND (:type = 'BOOK' OR m.year IS :year OR m.year = :year)`,
      { type, title, year },
    );
    if (hit) return hit.id;
  }
  return null;
}
const pitTitles = (it: Pick<ImportItem, 'title' | 'match' | 'tv'>) => [
  it.title,
  ...(it.match ? [it.match.title] : []),
  ...(it.tv?.alt_title ? [it.tv.alt_title] : []),
];

// ---------- Letterboxd ----------

export function startLetterboxdPreview(db: DB, user: string): ImportJob {
  return startJob('PREVIEW', async (job) => {
    const { films, partial, filmPages } = await readLetterboxdProfile(user, (msg) => (job.phase = msg));
    if (partial)
      job.notice = `Letterboxd only lets automated readers see your most recent films (page 1 of ${filmPages}; later pages are behind a bot check). Your whole watchlist is here. For your full film history, use the Letterboxd export instead.`;
    await matchFilms(db, job, films);
  });
}

/** Letterboxd's data export: ZIP (base64) or the loose CSVs. Full history, star ratings and diary watch dates. */
export function startLetterboxdExportPreview(db: DB, input: { zip?: string; files?: Record<string, string> }): ImportJob {
  const files = input.zip
    ? unzipText(Buffer.from(input.zip, 'base64'), (n) => /\.csv$/i.test(n) && !n.includes('/deleted/'))
    : new Map(Object.entries(input.files ?? {}));
  const films = parseLetterboxdExport(files);
  return startJob('PREVIEW', (job) => matchFilms(db, job, films));
}

async function matchFilms(db: DB, job: ImportJob, films: LetterboxdFilm[]) {
  job.total = films.length;
  const canMatch = tmdbConfigured();
  job.phase = canMatch ? 'Matching films on TMDb…' : 'TMDb is not configured, so films will be added by title only';
  const items: ImportItem[] = [];
  for (const f of films) {
    let match: ImportItem['match'] = null;
    if (canMatch) {
      try {
        let r = await searchMovies(f.title, f.year);
        if (!r.length && f.year) r = await searchMovies(f.title);
        const best = pickMatch(f, r);
        if (best) match = toMatch(best);
      } catch (err) {
        if (err instanceof AppError && err.code === 'PERMISSION_REQUIRED') throw err;
        // One failed search leaves that film unmatched; it can still be added by title.
      }
      await pause(GAP_MS());
    }
    const item: ImportItem = {
      key: f.key,
      source: 'LETTERBOXD',
      type: 'MOVIE',
      title: f.title,
      year: f.year,
      creator: null,
      rating: f.watched ? f.rating : null,
      status: f.watched ? 'COMPLETED' : 'PLANNED',
      completed_at: f.watched && f.watched_on ? `${f.watched_on}T12:00:00.000Z` : null,
      pages: null,
      isbn: null,
      source_url: f.source_url,
      match,
      in_pit: null,
    };
    item.in_pit = inPit(db, 'MOVIE', match, pitTitles(item), f.year);
    items.push(item);
    job.done++;
  }
  job.items = items;
  job.phase = 'Ready to review';
}

// ---------- Goodreads ----------

export function startGoodreadsPreview(db: DB, csv: string): ImportJob {
  const books = parseGoodreadsCsv(csv);
  if (!books.length) throw new AppError('VALIDATION_ERROR', 'The Goodreads export has no books in it');
  return startJob('PREVIEW', async (job) => {
    job.total = books.length;
    job.phase = 'Matching books on Open Library…';
    const items: ImportItem[] = [];
    for (const b of books) {
      let match: ImportItem['match'] = null;
      try {
        // ISBN finds the exact work; otherwise title + author, accepted only when the author matches. The fielded
        // search last: it also matches a translation's English title (e.g. "The Stranger" → "L’étranger").
        let best = b.isbn ? (await searchBooks(`isbn:${b.isbn}`))[0] : undefined;
        best ??= pickBook(b, await searchBooks(`${stripSeries(b.title)} ${b.author ?? ''}`.trim())) ?? undefined;
        if (!best && b.author) {
          await pause(GAP_MS());
          const q = (s: string) => s.replace(/"/g, '');
          best = (await searchBooks(`title:"${q(stripSeries(b.title))}" author:"${q(b.author)}"`)).find((r) => sameAuthor(b.author, r.creator));
        }
        if (best) match = toMatch(best);
      } catch {
        // Unmatched books can still be added from the export's own details.
      }
      await pause(GAP_MS());
      const item: ImportItem = {
        key: b.id,
        source: 'GOODREADS',
        type: 'BOOK',
        title: stripSeries(b.title),
        year: b.year,
        creator: b.author,
        rating: b.rating,
        status: b.status,
        completed_at: b.status === 'COMPLETED' && b.read_on ? `${b.read_on}T12:00:00.000Z` : null,
        pages: b.pages,
        isbn: b.isbn,
        source_url: `https://www.goodreads.com/book/show/${b.id}`,
        match,
        in_pit: null,
      };
      item.in_pit = inPit(db, 'BOOK', match, pitTitles(item), null);
      items.push(item);
      job.done++;
    }
    job.items = items;
    job.phase = 'Ready to review';
  });
}

// ---------- AniList ----------

/** AniList allows 30 requests a minute; 2.5 s apart keeps a whole list well under that. */
const ANILIST_GAP_MS = () => (GAP_MS() === 0 ? 0 : 2500);

/**
 * The anime list from AniList's GDPR data export. The export only holds AniList IDs, so titles, episode counts and
 * covers are looked up on AniList (50 per request). Everything goes to TV; the item is the AniList entry itself.
 */
export function startAnilistPreview(db: DB, entries: AnilistListEntry[]): ImportJob {
  const byId = new Map<number, AnilistListEntry>();
  for (const e of entries) if (anilistStatus(e.status) && !byId.has(e.series_id)) byId.set(e.series_id, e);
  if (!byId.size) throw new AppError('VALIDATION_ERROR', 'The AniList export has no anime in it');
  return startJob('PREVIEW', async (job) => {
    const ids = [...byId.keys()];
    job.total = ids.length;
    job.phase = 'Looking up your anime on AniList…';
    const media = await fetchAnilistMedia(ids, ANILIST_GAP_MS(), (done) => (job.done = done));
    const items: ImportItem[] = [];
    for (const [id, e] of byId) {
      const m = media.get(id);
      if (!m) continue;
      const status = anilistStatus(e.status)!;
      const item: ImportItem = {
        key: String(id),
        source: 'ANILIST',
        type: 'TV',
        title: m.title,
        year: m.year,
        creator: m.studio,
        rating: anilistRating(e.score),
        status,
        completed_at: status === 'COMPLETED' ? anilistDate(e.finished_on) : null,
        started_at: anilistDate(e.started_on),
        pages: null,
        isbn: null,
        source_url: `https://anilist.co/anime/${id}`,
        match: { provider: 'ANILIST', external_id: String(id), title: m.title, year: m.year, cover_url: m.cover_url, synopsis: m.synopsis, genres: m.genres },
        tv: { episodes: m.episodes, watched: Math.max(0, e.progress), format: m.format, runtime_min: m.runtime_min, alt_title: m.alt_title },
        in_pit: null,
      };
      item.in_pit = inPit(db, 'TV', item.match, pitTitles(item), m.year);
      items.push(item);
    }
    const missing = byId.size - items.length;
    if (missing)
      job.notice = `${missing} entr${missing === 1 ? 'y' : 'ies'} in the export no longer exist on AniList, so ${missing === 1 ? 'it was' : 'they were'} left out.`;
    job.items = items;
    job.phase = 'Ready to review';
  });
}

/**
 * Episodes for an imported anime: one season of AniList's count (aired-so-far for airing shows), stored like a manual
 * show, then the first `watched` marked watched. Completed shows count as fully watched. When AniList doesn't know
 * the count, the owner's own progress is the only number there is. Watch times aren't in the export, so they stay empty.
 */
function addAnimeEpisodes(db: DB, mediaId: string, entryId: string, status: ImportItem['status'], tv: NonNullable<ImportItem['tv']>) {
  const count = Math.max(tv.episodes ?? 0, tv.watched);
  if (!count) return;
  createManualSeasons(db, mediaId, [count]);
  const watched = status === 'COMPLETED' ? count : Math.min(tv.watched, count);
  if (!watched) return;
  run(
    db,
    `INSERT INTO episode_watch_states (entry_id, episode_id, watched, watched_at)
     SELECT :entry, id, 1, NULL FROM tv_episodes WHERE media_id = :media AND number <= :n`,
    { entry: entryId, media: mediaId, n: watched },
  );
}

// ---------- import ----------

export function startImport(db: DB, dataDir: string, items: ImportItem[]): ImportJob {
  return startJob('IMPORT', async (job) => {
    job.total = items.length;
    job.phase = 'Adding to the Pit…';
    const result = { added: 0, skipped: 0, failed: [] as string[] };
    const imdbLinked: string[] = [];
    for (const it of items) {
      try {
        const m = it.match;
        if (inPit(db, it.type, m, pitTitles(it), it.year)) {
          result.skipped++;
          continue;
        }
        const book = it.type === 'BOOK';
        const { entryId } = addToPit(db, {
          type: it.type,
          // Books keep the source's title (what the owner knows it as); films take TMDb's canonical title.
          title: book ? it.title : (m?.title ?? it.title),
          year: m?.year ?? it.year,
          synopsis: m?.synopsis ?? null,
          cover_url: m?.cover_url ?? null,
          genres: m?.genres ?? [],
          creator: it.creator,
          runtime_min: it.tv?.runtime_min ?? null,
          metadata_source: m?.provider ?? it.source,
          source_url: m
            ? m.provider === 'TMDB'
              ? `https://www.themoviedb.org/movie/${m.external_id}`
              : m.provider === 'ANILIST'
                ? `https://anilist.co/anime/${m.external_id}`
                : `https://openlibrary.org${m.external_id}`
            : it.source_url,
          external: m ? { provider: m.provider, object_type: it.type, external_id: m.external_id } : null,
          pages: it.pages,
          pages_source: it.pages ? 'Goodreads export (your edition)' : null,
          isbn: it.isbn,
        });
        run(
          db,
          `UPDATE library_entries SET status = :status, personal_rating = :rating, completed_at = :completed, started_at = :started,
             current_page = :page, updated_at = :now WHERE id = :id`,
          {
            status: it.status,
            rating: it.rating,
            completed: it.status === 'COMPLETED' ? it.completed_at : null,
            started: it.started_at ?? (it.status === 'IN_PROGRESS' ? nowIso() : null),
            page: book && it.status === 'COMPLETED' ? it.pages : null,
            now: nowIso(),
            id: entryId,
          },
        );
        if (it.type === 'TV' && it.tv) {
          const mediaId = get<{ media_id: string }>(db, 'SELECT media_id FROM library_entries WHERE id = :id', { id: entryId })!.media_id;
          addAnimeEpisodes(db, mediaId, entryId, it.status, it.tv);
        }
        result.added++;
        if (m?.provider === 'TMDB') {
          const mediaId = get<{ media_id: string }>(db, 'SELECT media_id FROM library_entries WHERE id = :id', { id: entryId })!.media_id;
          try {
            const d = await movieDetail(m.external_id);
            run(
              db,
              `UPDATE media_items SET runtime_min = :runtime, creator = COALESCE(creator, :director), genres = CASE WHEN :genres = '[]' THEN genres ELSE :genres END WHERE id = :id`,
              {
                runtime: d.runtime_min,
                director: d.director,
                genres: JSON.stringify(d.genres),
                id: mediaId,
              },
            );
            if (storeImdbId(db, mediaId, 'MOVIE', d.imdb_id)) imdbLinked.push(mediaId);
          } catch {
            // Runtime/director/IMDb link fill in later from the hourly maintenance; the entry is already saved.
          }
          await pause(GAP_MS());
        }
      } catch {
        result.failed.push(it.title);
      } finally {
        job.done++;
      }
    }
    job.result = result;
    job.phase = 'Done';
    // IMDb scores come from the local dataset in one pass; RT audience scores trickle in through the hourly job.
    if (imdbLinked.length) void syncImdbRatings(db, dataDir, imdbLinked).catch(() => undefined);
  });
}
