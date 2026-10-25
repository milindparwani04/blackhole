import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { all, nowIso, run, tx, type DB } from '../db/db.js';
import { downloadFile } from './http.js';
import { showImdbId } from './tvmaze.js';

/**
 * Episode and movie ratings from IMDb's official non-commercial datasets (https://developer.imdb.com/non-commercial-datasets/).
 * Two gzipped TSVs are downloaded at most once a day into DATA_DIR/imdb and streamed locally; no imdb.com pages are fetched.
 * Episodes are matched to TVmaze's by season + episode number via the show's IMDb ID (which TVmaze supplies);
 * movies via the IMDb ID TMDb supplies.
 */
const BASE = 'https://datasets.imdbws.com';
const EPISODES = 'title.episode.tsv.gz';
const RATINGS = 'title.ratings.tsv.gz';
const STALE_MS = 24 * 60 * 60 * 1000;
export const IMDB_ATTRIBUTION = 'Information courtesy of IMDb (https://www.imdb.com). Used with permission.';

/** Stores the show's IMDb ID (from TVmaze) so ratings can be matched. Returns null when TVmaze has none. */
export async function linkImdbId(db: DB, mediaId: string, tvmazeId: string): Promise<string | null> {
  return storeImdbId(db, mediaId, 'TV', await showImdbId(tvmazeId));
}

export function storeImdbId(db: DB, mediaId: string, objectType: 'TV' | 'MOVIE', imdb: string | null): string | null {
  if (!imdb || !/^tt\d{7,10}$/.test(imdb)) return null;
  run(db, `DELETE FROM external_ids WHERE provider = 'IMDB' AND media_id = :m AND external_id != :x`, { m: mediaId, x: imdb });
  run(db, `INSERT OR IGNORE INTO external_ids (provider, object_type, external_id, media_id) VALUES ('IMDB', :t, :x, :m)`, { t: objectType, x: imdb, m: mediaId });
  return imdb;
}

/** Downloads missing/day-old dataset files. A stale copy is kept and used when IMDb can't be reached. */
async function ensureDatasets(dir: string, names = [EPISODES, RATINGS]): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const file = path.join(dir, name);
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (st && Date.now() - st.mtimeMs < STALE_MS) continue;
    try {
      const changed = await downloadFile(`${BASE}/${name}`, file, { ifModifiedSince: st?.mtime });
      // Unchanged upstream: touch it so we don't ask again for another day.
      if (!changed && st) fs.utimesSync(file, new Date(), new Date());
    } catch (err) {
      if (!st) throw err;
    }
  }
}

function lines(file: string) {
  return readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

let queue: Promise<unknown> = Promise.resolve();
// What the last full parse covered, so the hourly job only re-reads the datasets when they or the linked titles change.
let parsed = { stamp: '', media: new Set<string>() };

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Refreshes IMDb ratings for linked shows (episode ratings) and movies (title rating), for all of them or just
 * `mediaIds`. Calls are serialised so concurrent triggers never download or parse the datasets twice at once.
 * Anything IMDb has no rating for gets none — never zero.
 */
export function syncImdbRatings(db: DB, dataDir: string, mediaIds?: string[]): Promise<{ rated: number }> {
  return serial(() => doSync(db, path.join(dataDir, 'imdb'), mediaIds));
}

/** One title's IMDb rating straight from the ratings file (used to preview a movie before it is added). */
export function imdbTitleRating(dataDir: string, tconst: string): Promise<{ score: number; votes: number } | null> {
  return serial(async () => {
    const dir = path.join(dataDir, 'imdb');
    await ensureDatasets(dir, [RATINGS]);
    for await (const line of lines(path.join(dir, RATINGS))) {
      if (!line.startsWith(tconst + '\t')) continue;
      const [, score, votes] = line.split('\t');
      return Number(score) >= 0 && Number(score) <= 10 ? { score: Number(score), votes: Number(votes) || 0 } : null;
    }
    return null;
  });
}

async function doSync(db: DB, dir: string, mediaIds?: string[]): Promise<{ rated: number }> {
  const links = all<{ media_id: string; external_id: string; object_type: string }>(
    db,
    `SELECT media_id, external_id, object_type FROM external_ids WHERE provider = 'IMDB' AND object_type IN ('TV', 'MOVIE')`,
  ).filter((l) => !mediaIds || mediaIds.includes(l.media_id));
  if (!links.length) return { rated: 0 };
  const shows = links.filter((l) => l.object_type === 'TV');
  const movies = links.filter((l) => l.object_type === 'MOVIE');
  const files = shows.length ? [EPISODES, RATINGS] : [RATINGS];
  await ensureDatasets(dir, files);
  const stamp = [EPISODES, RATINGS].map((n) => fs.statSync(path.join(dir, n), { throwIfNoEntry: false })?.mtimeMs ?? 0).join('|');
  if (!mediaIds && stamp === parsed.stamp && links.every((l) => parsed.media.has(l.media_id))) return { rated: 0 };

  // Keys: a movie's media id, or "media|season|episode" for episodes of linked shows.
  const wanted = new Map<string, string>(movies.map((l) => [l.external_id, l.media_id]));
  if (shows.length) {
    // Rows: tconst, parentTconst, seasonNumber, episodeNumber (\N when unknown). Only linked shows are kept in memory.
    const parents = new Map(shows.map((l) => [l.external_id, l.media_id]));
    for await (const line of lines(path.join(dir, EPISODES))) {
      const a = line.indexOf('\t');
      const b = line.indexOf('\t', a + 1);
      const mediaId = parents.get(line.slice(a + 1, b));
      if (!mediaId) continue;
      const [, , season, episode] = line.split('\t');
      if (/^\d+$/.test(season) && /^\d+$/.test(episode)) wanted.set(line.slice(0, a), `${mediaId}|${Number(season)}|${Number(episode)}`);
    }
  }
  // Rows: tconst, averageRating, numVotes.
  const scores = new Map<string, { score: number; votes: number }>();
  for await (const line of lines(path.join(dir, RATINGS))) {
    const key = wanted.get(line.slice(0, line.indexOf('\t')));
    if (!key) continue;
    const [, score, votes] = line.split('\t');
    if (Number(score) >= 0 && Number(score) <= 10) scores.set(key, { score: Number(score), votes: Number(votes) || 0 });
  }

  const now = nowIso();
  let rated = 0;
  tx(db, () => {
    for (const mediaId of new Set(shows.map((l) => l.media_id))) {
      const local = all<{ id: string; season: number; number: number }>(
        db,
        `SELECT e.id, s.number AS season, e.number FROM tv_episodes e JOIN tv_seasons s ON s.id = e.season_id WHERE e.media_id = :m AND s.is_special = 0`,
        { m: mediaId },
      );
      for (const ep of local) {
        const hit = scores.get(`${mediaId}|${ep.season}|${ep.number}`);
        if (!hit) {
          run(db, `DELETE FROM episode_ratings WHERE episode_id = :id AND provider = 'IMDB'`, { id: ep.id });
          continue;
        }
        rated++;
        run(
          db,
          `INSERT INTO episode_ratings (episode_id, provider, score, scale, fetched_at) VALUES (:id, 'IMDB', :score, 10, :now)
           ON CONFLICT (episode_id, provider) DO UPDATE SET score = excluded.score, fetched_at = excluded.fetched_at`,
          { id: ep.id, score: hit.score, now },
        );
      }
    }
    for (const l of movies) {
      const hit = scores.get(l.media_id);
      if (!hit) {
        run(db, `DELETE FROM media_ratings WHERE media_id = :m AND provider = 'IMDB'`, { m: l.media_id });
        continue;
      }
      rated++;
      run(
        db,
        `INSERT INTO media_ratings (media_id, provider, score, scale, votes, label, url, fetched_at) VALUES (:m, 'IMDB', :score, 10, :votes, NULL, :url, :now)
         ON CONFLICT (media_id, provider) DO UPDATE SET score = excluded.score, votes = excluded.votes, url = excluded.url, fetched_at = excluded.fetched_at`,
        { m: l.media_id, score: hit.score, votes: hit.votes, url: `https://www.imdb.com/title/${l.external_id}/`, now },
      );
    }
  });
  if (!mediaIds) parsed = { stamp, media: new Set(links.map((l) => l.media_id)) };
  return { rated };
}
