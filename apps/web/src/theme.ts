// Colour themes, picked from the top bar. The palettes live in styles/app.css under
// html[data-theme]; the swatch colours here are what the picker shows (background, text, accent).
export const THEMES = [
  { id: 'mono', name: 'Mono', swatch: ['#070707', '#f4f3ef', '#1ed760'] },
  { id: 'void', name: 'Void', swatch: ['#08080a', '#e9e9f0', '#8b5cf6'] },
  { id: 'night', name: 'Night', swatch: ['#0d1020', '#f3ead8', '#7ef0b0'] },
  { id: 'amber', name: 'Amber', swatch: ['#0a0700', '#ffd58a', '#ffb000'] },
  { id: 'phosphor', name: 'Phosphor', swatch: ['#020a04', '#c6ffd4', '#33ff77'] },
  { id: 'synthwave', name: 'Synthwave', swatch: ['#120a1f', '#ff3e9e', '#36e2ff'] },
  { id: 'arctic', name: 'Arctic', swatch: ['#0a1016', '#e6f1f8', '#5cc8ff'] },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'blackhole-theme';
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

export function savedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : 'mono';
  } catch {
    return 'mono';
  }
}

export function applyTheme(id: ThemeId) {
  if (id === 'void') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked: the theme still applies for this session
  }
}
