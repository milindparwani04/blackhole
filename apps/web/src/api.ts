import type {
  EntryDetail,
  LibraryRow,
  MediaType,
  MovieRatings,
  MutationResult,
  SearchResponse,
  Status,
} from '../../../packages/shared/src/index';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Blackhole': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('OFFLINE', 'The local Blackhole server is not reachable.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'ERROR', data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Stats {
  byType: Record<MediaType, { total: number; completed: number; in_progress: number }>;
  archived: number;
}

export interface AddPayload {
  type: MediaType;
  title: string;
  year?: number | null;
  synopsis?: string | null;
  cover_url?: string | null;
  genres?: string[];
  platforms?: string[];
  creator?: string | null;
  runtime_min?: number | null;
  source_url?: string | null;
  pages?: number | null;
  season_counts?: number[];
  play_platform?: string | null;
  external?: { provider: string; external_id: string } | null;
}

export const api = {
  health: () => req<{ ok: boolean; version: string }>('GET', '/api/health'),
  stats: () => req<Stats>('GET', '/api/stats'),
  providers: () => req<any[]>('GET', '/api/providers'),
  testProvider: (p: 'IGDB' | 'TMDB' | 'SEARXNG') => req<{ ok: boolean; message: string }>('POST', `/api/providers/${p}/test`),
  list: (p: { type?: MediaType; status?: Status; archived?: boolean; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (p.type) qs.set('type', p.type);
    if (p.status) qs.set('status', p.status);
    if (p.archived) qs.set('archived', 'true');
    if (p.q) qs.set('q', p.q);
    return req<LibraryRow[]>('GET', `/api/library?${qs}`);
  },
  detail: (id: string) => req<EntryDetail>('GET', `/api/library/${id}`),
  add: (p: AddPayload) => req<MutationResult & { duplicate: boolean; enrichment_error: string | null }>('POST', '/api/library', p),
  patch: (id: string, body: Record<string, unknown>) => req<MutationResult>('PATCH', `/api/library/${id}`, body),
  patchMedia: (id: string, body: Record<string, unknown>) => req<MutationResult>('PATCH', `/api/library/${id}/media`, body),
  complete: (id: string, kind: 'STORY' | 'PLATINUM' | 'WATCHED' | 'FINISHED' | 'SERIES', done: boolean) =>
    req<MutationResult>('POST', `/api/library/${id}/complete`, { kind, done }),
  status: (id: string, status: Status) => req<MutationResult>('POST', `/api/library/${id}/status`, { status }),
  archive: (id: string, archived: boolean) => req<MutationResult>('POST', `/api/library/${id}/archive`, { archived }),
  remove: (id: string) => req<{ deleted: true }>('DELETE', `/api/library/${id}`),
  undo: (eventId: string) => req<MutationResult>('POST', `/api/events/${eventId}/undo`),
  setTime: (id: string, body: Record<string, unknown>) => req<MutationResult>('PUT', `/api/games/${id}/times`, body),
  setTrophy: (id: string, body: Record<string, unknown>) => req<MutationResult>('PUT', `/api/games/${id}/trophies`, body),
  deleteTrophy: (id: string, trophyId: string) => req<MutationResult>('DELETE', `/api/games/${id}/trophies/${trophyId}`),
  trophyRefresh: (id: string) => req<MutationResult>('POST', `/api/games/${id}/trophy-refresh`),
  applyTrophyJob: (jobId: string) => req<MutationResult>('POST', `/api/trophy-jobs/${jobId}/apply`),
  revertTrophyJob: (jobId: string) => req<MutationResult>('POST', `/api/trophy-jobs/${jobId}/revert`),
  setPlayPlatform: (id: string, platform: string) => req<MutationResult>('POST', `/api/library/${id}/play-platform`, { platform }),
  igdbTime: (id: string) => req<MutationResult & { message: string }>('POST', `/api/games/${id}/igdb-time`),
  watchEpisode: (id: string, episodeId: string, watched: boolean) =>
    req<MutationResult>('POST', `/api/tv/${id}/episodes/${episodeId}/watch`, { watched }),
  watchSeason: (id: string, season: number | 'all', watched: boolean) =>
    req<MutationResult>('POST', `/api/tv/${id}/seasons/${season}/watch`, { watched }),
  syncTv: (id: string) => req<MutationResult>('POST', `/api/tv/${id}/sync`),
  refreshMovieRatings: (id: string) => req<MutationResult & { errors: string[] }>('POST', `/api/movies/${id}/ratings/refresh`),
  previewMovieRatings: (tmdbId: string) => req<MovieRatings>('GET', `/api/movies/preview-ratings?tmdb=${encodeURIComponent(tmdbId)}`),
  setEdition: (id: string, body: Record<string, unknown>) => req<MutationResult>('PUT', `/api/books/${id}/edition`, body),
  search: (type: MediaType, q: string) => req<SearchResponse>('GET', `/api/search?type=${type}&q=${encodeURIComponent(q)}`),
  backup: () => req<{ file: string; bytes: number }>('POST', '/api/backup'),
  backups: () => req<{ file: string; bytes: number }[]>('GET', '/api/backups'),
};
