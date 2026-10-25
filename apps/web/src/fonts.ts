// TEMPORARY: font trial. The owner is cycling through these to pick one; once chosen, set it as
// --font in styles/app.css and delete this file, the fontsource packages that lost, and <FontCycler>.
// Fonts are bundled (fontsource + public/fonts) because the CSP and local-first rule forbid web fonts.
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';

const FALLBACK = "'Cascadia Mono', Consolas, ui-monospace, monospace";

// adjust: font-size-adjust for faces whose letters run small at the app's px sizes.
export const FONTS = [
  { id: 'jetbrains', name: 'JetBrains Mono', stack: `'JetBrains Mono', ${FALLBACK}` },
  // milindparwani.com: Pixelify Sans, with PixC supplying its C/c. No adjust: font-size-adjust
  // scales each face by its own metrics, which blew the PixC C up past the Pixelify letters.
  { id: 'pixelify', name: 'Pixelify (site)', stack: `'PixC', 'Pixelify Sans', ${FALLBACK}` },
  { id: 'plex', name: 'IBM Plex Mono', stack: `'IBM Plex Mono', ${FALLBACK}` },
  { id: 'geist', name: 'Geist Mono', stack: `'Geist Mono', ${FALLBACK}` },
  { id: 'spacemono', name: 'Space Mono', stack: `'Space Mono', ${FALLBACK}` },
  { id: 'sharetech', name: 'Share Tech Mono', stack: `'Share Tech Mono', ${FALLBACK}` },
  { id: 'vt323', name: 'VT323', stack: `'VT323', ${FALLBACK}`, adjust: 'ex-height 0.55' },
  { id: 'grotesk', name: 'Space Grotesk', stack: `'Space Grotesk', system-ui, sans-serif` },
] as const;

export type FontId = (typeof FONTS)[number]['id'];

const KEY = 'blackhole-font';

export function savedFont(): FontId {
  try {
    const v = localStorage.getItem(KEY);
    return FONTS.some((f) => f.id === v) ? (v as FontId) : 'jetbrains';
  } catch {
    return 'jetbrains';
  }
}

export function applyFont(id: FontId) {
  const f: { stack: string; adjust?: string } = FONTS.find((x) => x.id === id) ?? FONTS[0];
  const root = document.documentElement.style;
  root.setProperty('--font', f.stack);
  root.setProperty('--font-adjust', f.adjust ?? 'none');
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked: the font still applies for this session
  }
}
