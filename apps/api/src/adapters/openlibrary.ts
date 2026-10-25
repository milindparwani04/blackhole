import type { SearchResult } from '../../../../packages/shared/src/index.js';
import { fetchJson, safeImage } from './http.js';

export const OPENLIBRARY_ATTRIBUTION = 'Book data from Open Library (openlibrary.org)';

interface OlDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  number_of_pages_median?: number;
  edition_count?: number;
  subject?: string[];
  isbn?: string[];
}

export async function searchBooks(q: string): Promise<SearchResult[]> {
  const fields = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,edition_count,subject,isbn';
  const data = await fetchJson<{ docs: OlDoc[] }>(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=${fields}`,
  );
  return data.docs
    .filter((d) => /^\/works\/OL\d+W$/.test(d.key))
    .map((d) => ({
      provider: 'OPENLIBRARY',
      external_id: d.key,
      type: 'BOOK' as const,
      title: d.title,
      year: d.first_publish_year ?? null,
      synopsis: null,
      cover_url: d.cover_i ? safeImage(`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`) : null,
      genres: (d.subject ?? []).slice(0, 3),
      platforms: [],
      creator: d.author_name?.slice(0, 2).join(', ') ?? null,
      runtime_min: null,
      source_url: `https://openlibrary.org${d.key}`,
      extra: d.edition_count ? `${d.edition_count} editions` : null,
      // Work-level median, not a specific edition: labelled as such and editable.
      pages: d.number_of_pages_median ?? null,
      already_in_pit: null,
    }));
}
