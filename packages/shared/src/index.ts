// Shared contracts between the local API and the web UI.

export const MEDIA_TYPES = ['GAME', 'MOVIE', 'TV', 'BOOK'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const STATUSES = ['PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'DROPPED'] as const;
export type Status = (typeof STATUSES)[number];

export const TIME_CATEGORIES = ['STORY', 'NORMAL', 'COMPLETIONIST'] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];

export const PS_PLATFORMS = ['PS5', 'PS4', 'PS3', 'PSVITA'] as const;
export type PsPlatform = (typeof PS_PLATFORMS)[number];

/** Platinum availability for a specific trophy stack. NOT_APPLICABLE is derived for non-PS editions. */
export type PlatinumState = 'YES' | 'NO' | 'UNKNOWN';

export type ApiErrorCode =
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'SOURCE_UNAVAILABLE' | 'RATE_LIMITED' | 'PERMISSION_REQUIRED' | 'FORBIDDEN_ORIGIN' | 'INTERNAL_ERROR';

export interface ApiError {
  error: { code: ApiErrorCode; message: string; requestId: string };
}

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  year: number | null;
  synopsis: string | null;
  cover_url: string | null;
  genres: string[];
  platforms: string[];
  creator: string | null;
  runtime_min: number | null;
  metadata_source: string;
  source_url: string | null;
  checked_at: string | null;
}

export interface LibraryEntry {
  id: string;
  media_id: string;
  status: Status;
  priority: number;
  owned: boolean;
  notes: string;
  personal_rating: number | null;
  current_page: number | null;
  started_at: string | null;
  completed_at: string | null;
  story_completed_at: string | null;
  platinum_earned_at: string | null;
  /** D-05: the platform the owner intends to play on; trophy stats follow this. */
  play_platform: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  version: number;
}

export interface TimeEstimate {
  category: TimeCategory;
  hours: number;
  source: string | null;
  source_url: string | null;
  checked_at: string | null;
  user_locked: boolean;
}

export interface TrophyGuide {
  id: string;
  platform: PsPlatform;
  region: string;
  platinum: PlatinumState;
  hours_min: number | null;
  hours_max: number | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  difficulty_text: string | null;
  playthroughs: number | null;
  online_required: boolean | null;
  missables: boolean | null;
  guide_url: string | null;
  source: string | null;
  checked_at: string | null;
  notes: string;
  user_locked: boolean;
}

export interface Episode {
  id: string;
  number: number;
  title: string | null;
  airdate: string | null;
  runtime_min: number | null;
  summary: string | null;
  released: boolean;
  watched: boolean;
  watched_at: string | null;
  rating: { provider: string; score: number; scale: number; fetched_at: string } | null;
}

export interface Season {
  id: string;
  number: number;
  is_special: boolean;
  episodes: Episode[];
  eligible: number;
  watched: number;
}

export interface TvProgress {
  eligible: number;
  watched: number;
  specials_watched: number;
  unreleased: number;
  watched_minutes: number;
  remaining_minutes: number;
  runtime_estimated: boolean;
  suggest_complete: boolean;
}

export interface ProgressEvent {
  id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
  undone_at: string | null;
  undoable: boolean;
}

export interface BookEdition {
  pages: number | null;
  isbn: string | null;
  format: string | null;
  pages_source: string | null;
}

/** A community rating for a whole title. IMDb is /10; Rotten Tomatoes audience is a % (/100). */
export interface MediaRating {
  score: number;
  scale: number;
  votes: number | null;
  label: string | null;
  url: string | null;
  fetched_at: string;
}

export interface MovieRatings {
  imdb: MediaRating | null;
  rt_audience: MediaRating | null;
}

export interface EntryDetail {
  entry: LibraryEntry;
  media: MediaItem;
  game?: {
    times: TimeEstimate[];
    trophies: TrophyGuide[];
    platinum_applicable: boolean;
    play_ps: PsPlatform | null;
    trophy_job: TrophyJob | null;
    igdb_linked: boolean;
  };
  tv?: { seasons: Season[]; progress: TvProgress; ratings_attribution: string | null };
  book?: { edition: BookEdition };
  /** `ratings_pending`: a background IMDb / RT refresh is still running (e.g. just after adding). */
  movie?: { ratings: MovieRatings; attribution: string[]; ratings_pending: boolean };
  events: ProgressEvent[];
}

/** Row shape returned by the library list endpoint. */
export interface LibraryRow {
  entry: LibraryEntry;
  media: MediaItem;
  normal_hours: number | null;
  platinum_hours: { min: number | null; max: number | null } | null;
  difficulty: { min: number | null; max: number | null } | null;
  platinum: PlatinumState | 'NOT_APPLICABLE' | null;
  tv: { eligible: number; watched: number; seasons: number } | null;
  pages: number | null;
  /** Movies only. */
  ratings: MovieRatings | null;
}

export interface SearchResult {
  provider: string;
  external_id: string;
  type: MediaType;
  title: string;
  year: number | null;
  synopsis: string | null;
  cover_url: string | null;
  genres: string[];
  platforms: string[];
  creator: string | null;
  runtime_min: number | null;
  source_url: string | null;
  extra: string | null;
  pages: number | null;
  already_in_pit: string | null;
}

export interface SearchResponse {
  provider: string | null;
  provider_status: 'OK' | 'NOT_CONFIGURED' | 'ERROR';
  message: string | null;
  attribution: string | null;
  results: SearchResult[];
}

export interface MutationResult {
  detail: EntryDetail;
  event_id: string | null;
}

export interface TrophyProposal {
  hours_min: number | null;
  hours_max: number | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  difficulty_text: string | null;
  playthroughs: number | null;
  online_required: boolean | null;
  missables: boolean | null;
  mentions_platinum: boolean;
  source?: string;
  guide_url?: string;
}

export interface TrophyCandidate {
  url: string;
  site: string;
  title: string;
  excerpt: string;
  platform_hint: PsPlatform | null;
  parsed: TrophyProposal;
  /** Right site, guide page, same game/version — whether or not values were found. */
  matched: boolean;
  accepted: boolean;
  /** Values were read from the guide page's roadmap box rather than the search summary. */
  from_page?: boolean;
  reason: string;
}

export interface TrophyJob {
  id: string;
  platform: PsPlatform;
  trigger: 'ADD' | 'REFRESH' | 'PLATFORM_CHANGE';
  status: 'RUNNING' | 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'NEEDS_REVIEW' | 'ERROR';
  query: string | null;
  candidates: TrophyCandidate[];
  proposal: TrophyProposal | null;
  previous: Record<string, unknown> | null;
  error: string | null;
  applied_at: string | null;
  reverted_at: string | null;
  created_at: string;
}

/** One film/book/show read from Letterboxd, a Goodreads export or an AniList export, with its provider match (if any). Nothing is stored until imported. */
export interface ImportItem {
  /** Unique within one preview (Letterboxd slug / Goodreads book id / AniList media id). */
  key: string;
  source: 'LETTERBOXD' | 'GOODREADS' | 'ANILIST';
  type: 'MOVIE' | 'BOOK' | 'TV';
  title: string;
  year: number | null;
  creator: string | null;
  /** The owner's rating converted to /10 (Letterboxd half stars → 1 point, Goodreads stars → 2 points); null when unrated. */
  rating: number | null;
  status: Status;
  /** Date finished when the source records one (Goodreads "Date Read"), else null. Never guessed. */
  completed_at: string | null;
  /** Date started when the source records one (AniList), else null. */
  started_at?: string | null;
  pages: number | null;
  isbn: string | null;
  source_url: string | null;
  match: {
    provider: 'TMDB' | 'OPENLIBRARY' | 'ANILIST';
    external_id: string;
    title: string;
    year: number | null;
    cover_url: string | null;
    synopsis: string | null;
    genres: string[];
  } | null;
  /**
   * Shows only (AniList): episodes out so far (null when the source doesn't know), how many the owner had watched,
   * AniList's format (TV, MOVIE, OVA…), minutes per episode and the other-language title.
   */
  tv?: { episodes: number | null; watched: number; format: string | null; runtime_min: number | null; alt_title: string | null } | null;
  /** Entry id when this title is already in the Pit. */
  in_pit: string | null;
}

export interface ImportJob {
  id: string;
  kind: 'PREVIEW' | 'IMPORT';
  phase: string;
  done: number;
  total: number;
  finished: boolean;
  error: string | null;
  /** Shown with the preview, e.g. when the source only exposed part of the list. */
  notice: string | null;
  items: ImportItem[] | null;
  result: { added: number; skipped: number; failed: string[] } | null;
}
