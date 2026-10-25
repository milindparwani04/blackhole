import zlib from 'node:zlib';
import { AppError } from '../security/errors.js';
import { fetchGuidePage } from './guidepage.js';
import { parseCsv } from './goodreads.js';

/**
 * Owner decision 2026-10-25 (revises D-06): one-off import of the owner's Letterboxd films and watchlist, two ways:
 *  - Profile link: reads the public `/<user>/films/` and `/<user>/watchlist/` grid pages through the guide-page reader
 *    (robots.txt honoured, bot checks never bypassed, ≥2.5 s apart). Letterboxd puts every films page after the first
 *    behind a Cloudflare challenge, so only page 1 (the 72 most recent films) is read and the result is marked partial.
 *  - Data export (Settings → Data → Export your data): the ZIP/CSVs hold the full history, ratings and diary dates.
 * The user supplies a username; Blackhole builds the URLs itself.
 */
export const LETTERBOXD_ATTRIBUTION = 'Film list and ratings imported from Letterboxd';
const MAX_WATCHLIST_PAGES = 60;

export interface LetterboxdFilm {
  /** Unique per film: the slug (profile pages) or `name|year` (export). */
  key: string;
  title: string;
  year: number | null;
  /** 1–10 (Letterboxd half-star units); null when unrated. */
  rating: number | null;
  watched: boolean;
  /** YYYY-MM-DD from the diary (export only). */
  watched_on: string | null;
  source_url: string | null;
}

/** Accepts a profile link (any page on it) or a bare username. */
export function letterboxdUser(input: string): string {
  const s = input.trim();
  let name = s;
  if (/letterboxd\.com/i.test(s)) {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^(www\.)?letterboxd\.com$/i.test(u.hostname)) throw new AppError('VALIDATION_ERROR', 'That is not a Letterboxd link');
    name = u.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  if (!/^[A-Za-z0-9_]{2,40}$/.test(name) || ['film', 'films', 'lists', 'members', 'search'].includes(name.toLowerCase()))
    throw new AppError('VALIDATION_ERROR', 'Paste your Letterboxd profile link, e.g. https://letterboxd.com/yourname/');
  return name;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Reads one poster-grid page: films in page order plus the highest page number linked from the pager. */
export function parseFilmGrid(html: string): { films: { slug: string; title: string; year: number | null; rating: number | null }[]; lastPage: number } {
  const films: { slug: string; title: string; year: number | null; rating: number | null }[] = [];
  for (const tile of html.split(/<li class="griditem/).slice(1)) {
    const name = tile.match(/data-item-name="([^"]*)"/)?.[1];
    const slug = tile.match(/data-item-slug="([^"]*)"/)?.[1];
    if (!name || !slug) continue;
    const full = decode(name);
    const m = full.match(/^(.*) \((\d{4})\)$/);
    const rated = Number(tile.match(/\brated-(\d{1,2})\b/)?.[1]);
    films.push({ slug, title: m ? m[1] : full, year: m ? Number(m[2]) : null, rating: rated >= 1 && rated <= 10 ? rated : null });
  }
  const pages = [...html.matchAll(/\/page\/(\d+)\//g)].map((x) => Number(x[1]));
  return { films, lastPage: Math.max(1, ...pages) };
}

async function readPage(url: string, user: string): Promise<string> {
  try {
    return await fetchGuidePage(url);
  } catch (err) {
    if (err instanceof AppError && /HTTP 404/.test(err.message)) throw new AppError('NOT_FOUND', `Letterboxd has no profile called “${user}”`);
    if (err instanceof AppError && err.code === 'PERMISSION_REQUIRED')
      throw new AppError('PERMISSION_REQUIRED', 'Letterboxd refused the request (bot check). Use the data export instead.');
    throw err;
  }
}

/**
 * Films (page 1 only; later pages are behind a bot check) and the full watchlist from the public profile.
 * `partial` is true when Letterboxd lists more films than the first page shows.
 */
export async function readLetterboxdProfile(
  user: string,
  onProgress?: (msg: string) => void,
): Promise<{ films: LetterboxdFilm[]; partial: boolean; filmPages: number }> {
  const tile =
    (watched: boolean) =>
    (f: ReturnType<typeof parseFilmGrid>['films'][number]): LetterboxdFilm => ({
      key: f.slug,
      title: f.title,
      year: f.year,
      rating: watched ? f.rating : null,
      watched,
      watched_on: null,
      source_url: `https://letterboxd.com/film/${f.slug}/`,
    });
  onProgress?.('Reading your Letterboxd films…');
  const first = parseFilmGrid(await readPage(`https://letterboxd.com/${user}/films/`, user));
  const out = first.films.map(tile(true));
  const seen = new Set(out.map((f) => f.key));
  let last = 1;
  for (let page = 1; page <= Math.min(last, MAX_WATCHLIST_PAGES); page++) {
    onProgress?.(`Reading your Letterboxd watchlist (page ${page}${last > 1 ? ` of ${last}` : ''})…`);
    const grid = parseFilmGrid(await readPage(`https://letterboxd.com/${user}/watchlist/${page > 1 ? `page/${page}/` : ''}`, user));
    last = grid.lastPage;
    // A film that is both watched and on the watchlist counts as watched.
    out.push(...grid.films.filter((f) => !seen.has(f.slug)).map(tile(false)));
  }
  return { films: out, partial: first.lastPage > 1, filmPages: first.lastPage };
}

// ---------- data export ----------

/** Minimal ZIP reader (stored / deflate entries) for the Letterboxd export; returns file name → text. */
export function unzipText(buf: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new AppError('VALIDATION_ERROR', 'That file is not a ZIP');
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new AppError('VALIDATION_ERROR', `Unsupported compression in ${name}`);
    out.set(name, (method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: 50_000_000 }) : data).toString('utf8'));
  }
  return out;
}

const rows = (csv: string | undefined) => {
  if (!csv) return [];
  const [head, ...body] = parseCsv(csv);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])) as Record<string, string>);
};

/**
 * Films from Letterboxd's export: watched.csv (+ ratings.csv for stars, diary.csv for the latest watch date) and
 * watchlist.csv. Files are matched by base name, so the ZIP or the loose CSVs both work.
 */
export function parseLetterboxdExport(files: Map<string, string>): LetterboxdFilm[] {
  const file = (n: string) => [...files].find(([k]) => k.split('/').pop()?.toLowerCase() === n)?.[1];
  const watched = rows(file('watched.csv'));
  const watchlist = rows(file('watchlist.csv'));
  if (!watched.length && !watchlist.length)
    throw new AppError('VALIDATION_ERROR', 'No watched.csv or watchlist.csv found. Use the ZIP from Letterboxd → Settings → Data → Export your data.');
  const key = (r: Record<string, string>) => `${r.Name}|${r.Year ?? ''}`;
  const ratings = new Map(rows(file('ratings.csv')).map((r) => [key(r), Number(r.Rating)]));
  const watchedOn = new Map<string, string>();
  for (const d of rows(file('diary.csv'))) {
    const on = d['Watched Date'];
    if (/^\d{4}-\d{2}-\d{2}$/.test(on) && on > (watchedOn.get(key(d)) ?? '')) watchedOn.set(key(d), on);
  }
  const film = (r: Record<string, string>, isWatched: boolean): LetterboxdFilm => {
    const stars = ratings.get(key(r));
    return {
      key: key(r),
      title: r.Name,
      year: /^\d{4}$/.test(r.Year) ? Number(r.Year) : null,
      rating: isWatched && stars && stars >= 0.5 && stars <= 5 ? Math.round(stars * 2) : null,
      watched: isWatched,
      watched_on: isWatched ? (watchedOn.get(key(r)) ?? null) : null,
      source_url: /^https:\/\/boxd\.it\/\w+$/.test(r['Letterboxd URI']) ? r['Letterboxd URI'] : null,
    };
  };
  const seen = new Set(watched.map(key));
  return [...watched.filter((r) => r.Name).map((r) => film(r, true)), ...watchlist.filter((r) => r.Name && !seen.has(key(r))).map((r) => film(r, false))];
}
