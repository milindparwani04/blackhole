import type { LibraryRow } from './index.js';

/**
 * The home-page slots for one media type: anything in progress first (most recently touched), then the most
 * recently added items still in the backlog. Completed and dropped items are not backlog.
 */
export function backlogSlots(rows: LibraryRow[], n = 5): LibraryRow[] {
  const active = rows.filter((r) => r.entry.status === 'IN_PROGRESS').sort((a, b) => b.entry.updated_at.localeCompare(a.entry.updated_at));
  const waiting = rows.filter((r) => r.entry.status === 'PLANNED' || r.entry.status === 'PAUSED').sort((a, b) => b.entry.created_at.localeCompare(a.entry.created_at));
  return [...active, ...waiting].slice(0, n);
}
