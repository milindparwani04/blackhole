import type { Status } from '../../../../packages/shared/src/index.js';
import { AppError } from '../security/errors.js';

/**
 * Goodreads has no public API and its robots.txt disallows the shelf pages, so the one-off import reads the owner's
 * own "Export Library" CSV (My Books → Import and export). Nothing is fetched from goodreads.com.
 */
export interface GoodreadsBook {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  /** 1–5 stars converted to /10; null when unrated (Goodreads writes 0). */
  rating: number | null;
  pages: number | null;
  year: number | null;
  status: Status;
  /** "Date Read" as YYYY-MM-DD, when Goodreads has one. */
  read_on: string | null;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** Goodreads wraps ISBNs as ="9780…" so spreadsheets keep the digits. */
const isbnOf = (v: string | undefined) => {
  const d = (v ?? '').replace(/[^0-9X]/gi, '');
  return d.length === 13 || d.length === 10 ? d : null;
};
const int = (v: string | undefined) => (/^\d+$/.test(v?.trim() ?? '') ? Number(v) : null);

function shelfStatus(shelf: string): Status {
  if (shelf === 'read') return 'COMPLETED';
  if (shelf === 'currently-reading') return 'IN_PROGRESS';
  if (/dnf|did-not-finish|abandon|gave-up|stopped/i.test(shelf)) return 'DROPPED';
  return 'PLANNED';
}

export function parseGoodreadsCsv(text: string): GoodreadsBook[] {
  const [head, ...rows] = parseCsv(text);
  const col = (name: string) => head?.indexOf(name) ?? -1;
  const need = ['Book Id', 'Title', 'Author', 'Exclusive Shelf'];
  if (!head || need.some((n) => col(n) < 0)) throw new AppError('VALIDATION_ERROR', 'That is not a Goodreads library export (expected the CSV from My Books → Import and export → Export Library)');
  const at = (r: string[], name: string) => (col(name) >= 0 ? r[col(name)]?.trim() : undefined);
  return rows
    .filter((r) => /^\d+$/.test(at(r, 'Book Id') ?? '') && at(r, 'Title'))
    .map((r) => {
      const stars = int(at(r, 'My Rating'));
      const read = at(r, 'Date Read')?.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      return {
        id: at(r, 'Book Id')!,
        title: at(r, 'Title')!,
        author: at(r, 'Author') || null,
        isbn: isbnOf(at(r, 'ISBN13')) ?? isbnOf(at(r, 'ISBN')),
        rating: stars && stars >= 1 && stars <= 5 ? stars * 2 : null,
        pages: int(at(r, 'Number of Pages')) || null,
        year: int(at(r, 'Original Publication Year')) ?? int(at(r, 'Year Published')),
        status: shelfStatus(at(r, 'Exclusive Shelf') ?? ''),
        read_on: read ? `${read[1]}-${read[2]}-${read[3]}` : null,
      };
    });
}

/** "Mistborn: The Final Empire (Mistborn, #1)" → "Mistborn: The Final Empire" (series tag removed for display and search). */
export const stripSeries = (title: string) => title.replace(/\s*\([^()]*#\s*[\d.]+[^()]*\)\s*$/, '').trim() || title;
