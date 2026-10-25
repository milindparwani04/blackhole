import { AppError } from '../security/errors.js';
import { fetchGuidePage } from './guidepage.js';
import { searx } from './searxng.js';

/**
 * Owner decision 2026-10-25: Rotten Tomatoes has no API, so Blackhole reads the audience score (Popcornmeter) from
 * the one matching rottentomatoes.com/m/… page, through the guide-page reader (robots.txt honoured, bot checks never
 * bypassed, requests spaced out). The page is only accepted when its title and year match the movie.
 */
const ORIGIN = 'https://www.rottentomatoes.com';
export const RT_ATTRIBUTION = 'Audience score (Popcornmeter) from Rotten Tomatoes';

export interface RtAudience {
  score: number;
  /** e.g. "5,000+ Verified Ratings" */
  label: string | null;
  url: string;
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

/** RT slugs: lowercase words joined by underscores, apostrophes dropped (e.g. dune_part_two, dune_2021). */
export function rtSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Reads the page's identity and audience score. Returns null when the page isn't this movie or has no score yet. */
export function parseRtPage(html: string, title: string, year: number | null): Omit<RtAudience, 'url'> | null {
  const named =
    /"titleName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1] ?? /property="og:title" content="([^"]*)"/.exec(html)?.[1]?.replace(/\s*\|\s*Rotten Tomatoes\s*$/, '');
  if (!named) return null;
  const pageTitle = named.replace(/\s*\(\d{4}\)\s*$/, '');
  const pageYear = Number(/"releaseYear":"?(\d{4})/.exec(html)?.[1] ?? /\((\d{4})\)\s*$/.exec(named)?.[1]) || null;
  const a = norm(pageTitle);
  const b = norm(title);
  if (!a || !b || !(a === b || a.includes(b) || b.includes(a))) return null;
  if (year && pageYear && Math.abs(pageYear - year) > 1) return null;
  const block = /"audienceScore":(\{[^{}]*\})/.exec(html)?.[1];
  if (!block) return null;
  try {
    const s = JSON.parse(block) as { score?: string | number | null; bandedRatingCount?: string };
    const score = Number(s.score);
    if (s.score == null || s.score === '' || !Number.isFinite(score) || score < 0 || score > 100) return null;
    return { score, label: s.bandedRatingCount ?? null };
  } catch {
    return null;
  }
}

/**
 * Finds the movie's RT page — guessed slugs first (title_year, then title), then one SearXNG search — and reads
 * the audience score. Returns null when no matching page has a score.
 */
export async function rtAudience(title: string, year: number | null): Promise<RtAudience | null> {
  const slug = rtSlug(title);
  const tried = new Set<string>();
  const tryUrl = async (url: string) => {
    if (tried.has(url)) return null;
    tried.add(url);
    try {
      const hit = parseRtPage(await fetchGuidePage(url), title, year);
      return hit ? { ...hit, url } : null;
    } catch (err) {
      // A missing page just means a wrong guess; a robots/bot-check refusal ends the attempt.
      if (err instanceof AppError && err.code === 'PERMISSION_REQUIRED') throw err;
      return null;
    }
  };
  if (slug) {
    for (const url of [year ? `${ORIGIN}/m/${slug}_${year}` : null, `${ORIGIN}/m/${slug}`]) {
      const hit = url && (await tryUrl(url));
      if (hit) return hit;
    }
  }
  let results: { url: string }[] = [];
  try {
    results = await searx(`${title} ${year ?? ''} rotten tomatoes`.replace(/\s+/g, ' '));
  } catch {
    return null;
  }
  for (const r of results.slice(0, 8)) {
    const m = /^https:\/\/www\.rottentomatoes\.com\/m\/([a-z0-9_-]+)\/?$/.exec(r.url);
    if (!m) continue;
    const hit = await tryUrl(`${ORIGIN}/m/${m[1]}`);
    if (hit) return hit;
  }
  return null;
}
