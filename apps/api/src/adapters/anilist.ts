import type { Status } from '../../../../packages/shared/src/index.js';
import { AppError } from '../security/errors.js';
import { fetchJson, plainText, safeImage } from './http.js';

const ENDPOINT = 'https://graphql.anilist.co';
export const ANILIST_ATTRIBUTION = 'Anime data from AniList (anilist.co)';

/** One anime row from the `lists` array of AniList's GDPR data export (only the fields Blackhole reads). */
export interface AnilistListEntry {
  series_id: number;
  status: number;
  /** Stored by AniList on a 0–100 scale whatever the owner's display format; 0 = unrated. */
  score: number;
  progress: number;
  /** yyyymmdd, 0 when not set. */
  started_on: number;
  finished_on: number;
}

/**
 * The export's numeric list statuses, checked against the same account's public list on 2026-10-27:
 * 0 Watching, 1 Planning, 2 Completed, 3 Dropped, 4 Paused, 5 Rewatching. Rewatching counts as Completed,
 * since Blackhole has no rewatch state and the show was finished at least once.
 */
const STATUS: Record<number, Status> = { 0: 'IN_PROGRESS', 1: 'PLANNED', 2: 'COMPLETED', 3: 'DROPPED', 4: 'PAUSED', 5: 'COMPLETED' };
export const anilistStatus = (n: number): Status | null => STATUS[n] ?? null;

/** 0–100 → 1–10; 0 means unrated, so it stays unknown rather than becoming a score. */
export const anilistRating = (score: number): number | null => (score > 0 ? Math.min(10, Math.max(1, Math.round(score / 10))) : null);

/** yyyymmdd → ISO at midday (like the other imports' dates), or null for 0 / an invalid date. */
export function anilistDate(n: number): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(n));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : `${iso}T12:00:00.000Z`;
}

export interface AnilistMedia {
  id: number;
  title: string;
  /** The other name (romaji or English) when it differs, for spotting a show already in the Pit. */
  alt_title: string | null;
  format: string | null;
  year: number | null;
  /** Episodes out so far: the total for finished shows, aired-so-far for airing ones, null when unknown. */
  episodes: number | null;
  runtime_min: number | null;
  genres: string[];
  synopsis: string | null;
  cover_url: string | null;
  studio: string | null;
}

interface RawMedia {
  id: number;
  title: { romaji: string | null; english: string | null } | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  duration: number | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
  genres: string[] | null;
  description: string | null;
  coverImage: { large: string | null } | null;
  studios: { nodes: { name: string }[] } | null;
  nextAiringEpisode: { episode: number } | null;
}

const QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(id_in: $ids, type: ANIME) {
      id title { romaji english } format status episodes duration seasonYear startDate { year } genres
      description(asHtml: false) coverImage { large } studios(isMain: true) { nodes { name } } nextAiringEpisode { episode }
    }
  }
}`;

export function mapAnilistMedia(m: RawMedia): AnilistMedia {
  const english = m.title?.english?.trim() || null;
  const romaji = m.title?.romaji?.trim() || null;
  const title = english ?? romaji ?? `AniList #${m.id}`;
  const aired = m.status === 'RELEASING' && m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : null;
  return {
    id: m.id,
    title,
    alt_title: romaji && romaji !== title ? romaji : null,
    format: m.format ?? null,
    year: m.seasonYear ?? m.startDate?.year ?? null,
    episodes: m.status === 'NOT_YET_RELEASED' ? 0 : m.status === 'RELEASING' ? (aired ?? null) : (m.episodes ?? null),
    runtime_min: m.duration ?? null,
    genres: (m.genres ?? []).slice(0, 10),
    synopsis: plainText(m.description),
    cover_url: safeImage(m.coverImage?.large),
    studio: m.studios?.nodes?.[0]?.name ?? null,
  };
}

/**
 * Looks up anime by AniList ID, 50 per request. AniList allows 30 requests a minute, so requests are spaced by
 * `gapMs`; a rate-limited page waits a minute and is tried once more. IDs AniList no longer has are simply absent.
 */
export async function fetchAnilistMedia(ids: number[], gapMs: number, onPage: (done: number) => void = () => {}): Promise<Map<number, AnilistMedia>> {
  const out = new Map<number, AnilistMedia>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const body = JSON.stringify({ query: QUERY, variables: { ids: chunk, page: 1 } });
    const post = () =>
      fetchJson<{ data?: { Page: { media: RawMedia[] } } }>(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeoutMs: 15_000,
      });
    let res;
    try {
      res = await post();
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'RATE_LIMITED')) throw err;
      // A zero gap (tests) skips the minute's wait.
      await new Promise((r) => setTimeout(r, gapMs > 0 ? 60_000 : 0));
      res = await post();
    }
    for (const m of res.data?.Page.media ?? []) out.set(m.id, mapAnilistMedia(m));
    onPage(Math.min(ids.length, i + 50));
    if (i + 50 < ids.length) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}
