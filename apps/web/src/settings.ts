import { useCallback, useSyncExternalStore } from 'react';
import type { LibraryRow } from '../../../packages/shared/src/index';

/** Display preferences. Kept in this browser's localStorage: they change how the UI looks, not the library. */
export interface Settings {
  /** Show IMDb and Rotten Tomatoes ratings (movie scores, episode ratings, rating filters). */
  showReviews: boolean;
  /** Include anime (TV shows imported from AniList) in the TV list, its home backlog and its spin wheel. */
  includeAnime: boolean;
  /** Include manga (books imported from AniList) in the Books list, its home backlog and its spin wheel. */
  includeManga: boolean;
}

/** Size of every element (1 = 100%). Fixed: browser zoom is blocked, so this is the app's only zoom. */
const GUI_SCALE = 1.25;
const DEFAULTS: Settings = { showReviews: true, includeAnime: true, includeManga: true };
const KEY = 'blackhole.settings';

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const flag = (k: keyof Settings) => (typeof raw[k] === 'boolean' ? raw[k] : DEFAULTS[k]);
    return { showReviews: flag('showReviews'), includeAnime: flag('includeAnime'), includeManga: flag('includeManga') };
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

/** True when a row passes the anime/manga include toggles. Anime and manga are the TV shows and books imported from AniList. */
export function useAnilistFilter(): (r: LibraryRow) => boolean {
  const { includeAnime, includeManga } = useSettings();
  return useCallback(
    (r: LibraryRow) => r.media.metadata_source !== 'ANILIST' || (r.media.type === 'TV' ? includeAnime : r.media.type === 'BOOK' ? includeManga : true),
    [includeAnime, includeManga],
  );
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
