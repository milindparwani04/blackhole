import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { LibraryRow } from '../../../packages/shared/src/index';
import type { Stats } from './api';

/** Display preferences. Kept in this browser's localStorage: they change how the UI looks, not the library. */
export interface Settings {
  /** Show IMDb and Rotten Tomatoes ratings (movie scores, episode ratings, rating filters). */
  showReviews: boolean;
  /** Anime (TV shows from AniList) in the TV list, its home backlog, its spin wheel and the totals: all shows, none, or only anime. */
  anime: AnilistMode;
  /** Manga (books from AniList), the same way for Books. */
  manga: AnilistMode;
}

/** ALL: everything. HIDE: leave the AniList titles out. ONLY: just the AniList titles. */
export type AnilistMode = 'ALL' | 'HIDE' | 'ONLY';
const MODES: readonly AnilistMode[] = ['ALL', 'HIDE', 'ONLY'];

/** Size of every element (1 = 100%). Fixed: browser zoom is blocked, so this is the app's only zoom. */
const GUI_SCALE = 1.25;
const DEFAULTS: Settings = { showReviews: true, anime: 'ALL', manga: 'ALL' };
const KEY = 'blackhole.settings';

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Older settings stored include toggles (includeAnime/includeManga); an "off" one becomes HIDE.
    const mode = (k: 'anime' | 'manga', legacy: string): AnilistMode => (MODES.includes(raw[k]) ? raw[k] : raw[legacy] === false ? 'HIDE' : 'ALL');
    return {
      showReviews: typeof raw.showReviews === 'boolean' ? raw.showReviews : DEFAULTS.showReviews,
      anime: mode('anime', 'includeAnime'),
      manga: mode('manga', 'includeManga'),
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

// CSS zoom scales the whole UI; --gui-scale lets viewport-height rules divide it back out.
document.documentElement.style.zoom = String(GUI_SCALE);
document.documentElement.style.setProperty('--gui-scale', String(GUI_SCALE));

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the change still applies for this session.
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

const passes = (mode: AnilistMode, fromAnilist: boolean) => mode === 'ALL' || (mode === 'ONLY') === fromAnilist;

/** True when a row passes the anime/manga filters. Anime and manga are the TV shows and books from AniList (imported or added via /anime, /manga). */
export function useAnilistFilter(): (r: LibraryRow) => boolean {
  const { anime, manga } = useSettings();
  return useCallback(
    (r: LibraryRow) => {
      const ani = r.media.metadata_source === 'ANILIST';
      return r.media.type === 'TV' ? passes(anime, ani) : r.media.type === 'BOOK' ? passes(manga, ani) : true;
    },
    [anime, manga],
  );
}

/** Library totals following the anime/manga filters (sidebar and home stat cards). */
export function useVisibleStats(stats: Stats | null): Stats | null {
  const { anime, manga } = useSettings();
  return useMemo(() => {
    if (!stats || (anime === 'ALL' && manga === 'ALL')) return stats;
    const byType = { ...stats.byType };
    for (const [t, mode] of [
      ['TV', anime],
      ['BOOK', manga],
    ] as const) {
      if (mode === 'ALL') continue;
      const all = stats.byType[t];
      const ani = stats.anilist[t];
      byType[t] =
        mode === 'ONLY' ? ani : { total: all.total - ani.total, completed: all.completed - ani.completed, in_progress: all.in_progress - ani.in_progress };
    }
    return { ...stats, byType };
  }, [stats, anime, manga]);
}

/** Browser zoom is disabled: Ctrl/⌘ + wheel, Ctrl/⌘ + plus/minus/0 and pinch do nothing. The fixed GUI scale is the only zoom. */
export function blockBrowserZoom() {
  addEventListener('wheel', (e) => (e.ctrlKey || e.metaKey) && e.preventDefault(), { passive: false });
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault();
  });
  // Safari pinch gestures.
  for (const type of ['gesturestart', 'gesturechange']) addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
