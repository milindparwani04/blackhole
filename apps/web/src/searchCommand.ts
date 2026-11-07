import { kindType, type MediaType, type SearchKind } from '../../../packages/shared/src/index.js';

// Top-bar search commands: "/book red rising" searches books for "red rising". /anime and /manga search AniList and add
// to TV shows and Books, tagged as anime/manga so the anime and manga filters see them.
export const COMMANDS: { cmd: string; kind: SearchKind; aliases: string[] }[] = [
  { cmd: 'game', kind: 'GAME', aliases: ['game', 'games'] },
  { cmd: 'movie', kind: 'MOVIE', aliases: ['movie', 'movies', 'film', 'films'] },
  { cmd: 'tv', kind: 'TV', aliases: ['tv', 'show', 'shows', 'series'] },
  { cmd: 'anime', kind: 'ANIME', aliases: ['anime'] },
  { cmd: 'book', kind: 'BOOK', aliases: ['book', 'books'] },
  { cmd: 'manga', kind: 'MANGA', aliases: ['manga'] },
];

export interface ParsedSearch {
  /** What a complete command searches for, else null. */
  kind: SearchKind | null;
  /** The library type that kind lives in (anime → TV, manga → BOOK), else null. */
  type: MediaType | null;
  /** The search text after any command. */
  text: string;
  /** Set while a command is still being typed ("/bo"): the letters so far, lower-cased. */
  partial: string | null;
}

export function parseSearch(raw: string): ParsedSearch {
  const m = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(raw.trimStart());
  if (!m) return { kind: null, type: null, text: raw.trim(), partial: null };
  const word = m[1].toLowerCase();
  const hit = COMMANDS.find((c) => c.aliases.includes(word));
  const text = (m[2] ?? '').trim();
  if (hit) return { kind: hit.kind, type: kindType(hit.kind), text, partial: null };
  // Unknown command: still being typed until a space follows it.
  return { kind: null, type: null, text, partial: m[2] === undefined ? word : null };
}

/** Commands whose name or an alias starts with what has been typed so far. */
export const matchCommands = (partial: string) => COMMANDS.filter((c) => c.aliases.some((a) => a.startsWith(partial)));
