import type { MediaType } from '../../../packages/shared/src/index.js';

// Top-bar search commands: "/book red rising" searches books for "red rising".
export const COMMANDS: { cmd: string; type: MediaType; aliases: string[] }[] = [
  { cmd: 'game', type: 'GAME', aliases: ['game', 'games'] },
  { cmd: 'movie', type: 'MOVIE', aliases: ['movie', 'movies', 'film', 'films'] },
  { cmd: 'tv', type: 'TV', aliases: ['tv', 'show', 'shows', 'series'] },
  { cmd: 'book', type: 'BOOK', aliases: ['book', 'books'] },
];

export interface ParsedSearch {
  /** Media type named by a complete command, else null. */
  type: MediaType | null;
  /** The search text after any command. */
  text: string;
  /** Set while a command is still being typed ("/bo"): the letters so far, lower-cased. */
  partial: string | null;
}

export function parseSearch(raw: string): ParsedSearch {
  const m = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(raw.trimStart());
  if (!m) return { type: null, text: raw.trim(), partial: null };
  const word = m[1].toLowerCase();
  const hit = COMMANDS.find((c) => c.aliases.includes(word));
  const text = (m[2] ?? '').trim();
  if (hit) return { type: hit.type, text, partial: null };
  // Unknown command: still being typed until a space follows it.
  return { type: null, text, partial: m[2] === undefined ? word : null };
}

/** Commands whose name or an alias starts with what has been typed so far. */
export const matchCommands = (partial: string) => COMMANDS.filter((c) => c.aliases.some((a) => a.startsWith(partial)));
