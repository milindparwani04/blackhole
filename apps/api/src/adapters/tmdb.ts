import type { SearchResult } from '../../../../packages/shared/src/index.js';
import { providerConfig } from '../config.js';
import { AppError } from '../security/errors.js';
import { fetchJson, plainText, safeImage } from './http.js';

// Wording required by TMDb's terms for apps using the API.
export const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

const GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama',
  10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

interface TmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  genre_ids?: number[];
}

interface TmdbDetail extends TmdbMovie {
  runtime?: number | null;
  genres?: { id: number; name: string }[];
  credits?: { crew?: { job: string; name: string }[] };
}

/** Accepts either a v4 "API Read Access Token" (Bearer) or a 32-char v3 API key. */
function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const t = providerConfig().tmdb.token;
  if (!t) throw new AppError('PERMISSION_REQUIRED', 'TMDb is not configured (TMDB_API_TOKEN)');
  const v3 = /^[a-f0-9]{32}$/i.test(t);
  const qs = new URLSearchParams({ ...params, ...(v3 ? { api_key: t } : {}) });
  return fetchJson<T>(`https://api.themoviedb.org/3/${path}?${qs}`, { headers: v3 ? {} : { Authorization: `Bearer ${t}` } });
}

const poster = (p?: string | null) => (p && /^\/[\w.-]+$/.test(p) ? safeImage(`https://image.tmdb.org/t/p/w342${p}`) : null);

export async function searchMovies(q: string): Promise<SearchResult[]> {
  const r = await tmdb<{ results: TmdbMovie[] }>('search/movie', { query: q, include_adult: 'false', language: 'en-GB' });
  return r.results.slice(0, 15).map((m) => ({
    provider: 'TMDB',
    external_id: String(m.id),
    type: 'MOVIE' as const,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) || null : null,
    synopsis: plainText(m.overview),
    cover_url: poster(m.poster_path),
    genres: (m.genre_ids ?? []).map((g) => GENRES[g]).filter(Boolean).slice(0, 3),
    platforms: [],
    creator: null,
    runtime_min: null,
    source_url: `https://www.themoviedb.org/movie/${m.id}`,
    extra: m.original_title && m.original_title !== m.title ? m.original_title : null,
    pages: null,
    already_in_pit: null,
  }));
}

/** Runtime and director only come from the detail endpoint. */
export async function movieDetail(id: string): Promise<{ runtime_min: number | null; director: string | null; genres: string[] }> {
  if (!/^\d+$/.test(id)) throw new AppError('VALIDATION_ERROR', 'Invalid TMDb id');
  const d = await tmdb<TmdbDetail>(`movie/${id}`, { append_to_response: 'credits', language: 'en-GB' });
  return {
    runtime_min: d.runtime && d.runtime > 0 ? d.runtime : null,
    director: d.credits?.crew?.find((c) => c.job === 'Director')?.name ?? null,
    genres: (d.genres ?? []).map((g) => g.name).slice(0, 4),
  };
}

export async function testTmdb(): Promise<string> {
  const r = await tmdb<{ title: string }>('movie/603');
  return `Connected — sample lookup returned “${r.title}”`;
}
