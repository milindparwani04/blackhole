import { useSyncExternalStore } from 'react';

/** Display preferences. Kept in this browser's localStorage: they change how the UI looks, not the library. */
export interface Settings {
  /** Size of every element, like Minecraft's GUI Scale. 1 = 100%. The only zoom the app allows. */
  guiScale: number;
  /** Show IMDb and Rotten Tomatoes ratings (movie scores, episode ratings, rating filters). */
  showReviews: boolean;
}

export const GUI_SCALES = [0.75, 0.875, 1, 1.125, 1.25, 1.5] as const;
const DEFAULTS: Settings = { guiScale: 1, showReviews: true };
const KEY = 'blackhole.settings';

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      guiScale: (GUI_SCALES as readonly number[]).includes(raw.guiScale) ? raw.guiScale : DEFAULTS.guiScale,
      showReviews: typeof raw.showReviews === 'boolean' ? raw.showReviews : DEFAULTS.showReviews,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

function apply() {
  // CSS zoom scales the whole UI; --gui-scale lets viewport-height rules divide it back out.
  const root = document.documentElement;
  root.style.zoom = String(current.guiScale);
  root.style.setProperty('--gui-scale', String(current.guiScale));
}
apply();

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the change still applies for this session.
  }
  apply();
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

/** Browser zoom is disabled: Ctrl/⌘ + wheel, Ctrl/⌘ + plus/minus/0 and pinch do nothing. GUI scale is the only zoom. */
export function blockBrowserZoom() {
  addEventListener('wheel', (e) => (e.ctrlKey || e.metaKey) && e.preventDefault(), { passive: false });
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault();
  });
  // Safari pinch gestures.
  for (const type of ['gesturestart', 'gesturechange']) addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
