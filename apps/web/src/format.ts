import type { MediaType, SearchKind, Status } from '../../../packages/shared/src/index';

/** dd/mm/yyyy in the user's local zone. Accepts ISO timestamps or YYYY-MM-DD. */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB');
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return '—';
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export function fmtRange(min: number | null | undefined, max: number | null | undefined, unit = 'h'): string {
  if (min == null && max == null) return '—';
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (min != null && max != null && min !== max) return `${f(min)}–${f(max)}${unit}`;
  return `${f((min ?? max)!)}${unit}`;
}

export function fmtMinutes(m: number): string {
  if (!m) return '0h';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
}

export const STATUS_LABEL: Record<Status, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
};

export const TYPE_LABEL: Record<MediaType, { one: string; many: string; done: string; verb: string }> = {
  GAME: { one: 'Game', many: 'Games', done: 'Completed', verb: 'Playing' },
  MOVIE: { one: 'Movie', many: 'Movies', done: 'Watched', verb: 'Watching' },
  TV: { one: 'TV show', many: 'TV Shows', done: 'Watched', verb: 'Watching' },
  BOOK: { one: 'Book', many: 'Books', done: 'Read', verb: 'Reading' },
};

/** Add-dialog tabs and search commands: the media types plus anime and manga (AniList). */
export const KIND_LABEL: Record<SearchKind, string> = { GAME: 'Game', MOVIE: 'Movie', TV: 'TV show', ANIME: 'Anime', BOOK: 'Book', MANGA: 'Manga' };
export const KIND_SEARCH: Record<SearchKind, string> = {
  GAME: 'games',
  MOVIE: 'movies',
  TV: 'TV shows',
  ANIME: 'anime on AniList',
  BOOK: 'books',
  MANGA: 'manga on AniList',
};

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
