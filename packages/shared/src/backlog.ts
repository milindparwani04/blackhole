import type { LibraryRow } from './index.js';

/**
 * The home-page slots for one media type: anything in progress first (most recently touched), then the most
 * recently added items still in the backlog. Completed and dropped items are not backlog.
 */
export function backlogSlots(rows: LibraryRow[], n = 5): LibraryRow[] {
  const active = rows.filter((r) => r.entry.status === 'IN_PROGRESS').sort((a, b) => b.entry.updated_at.localeCompare(a.entry.updated_at));
  const waiting = rows
    .filter((r) => r.entry.status === 'PLANNED' || r.entry.status === 'PAUSED')
    .sort((a, b) => b.entry.created_at.localeCompare(a.entry.created_at));
  return [...active, ...waiting].slice(0, n);
}

/**
 * How many rows of at least `rowMin` px fit in `height` px, between 1 and `max`. A missing or invalid
 * `rowMin` (NaN, 0) means "not constrained": all `max` rows show.
 */
export function fitRowCount(height: number, rowMin: number, max: number): number {
  if (!(rowMin > 0)) return max;
  return Math.max(1, Math.min(max, Math.floor(height / rowMin)));
}

/** What the spin wheel picks from: everything still waiting in the backlog (Planned or Paused), oldest first. */
export function spinPool(rows: LibraryRow[]): LibraryRow[] {
  return rows
    .filter((r) => !r.entry.archived_at && (r.entry.status === 'PLANNED' || r.entry.status === 'PAUSED'))
    .sort((a, b) => a.entry.created_at.localeCompare(b.entry.created_at));
}

/**
 * The wheel's slice under the top pointer when it's turned `rotation` degrees clockwise. Slice i covers
 * [i, i + 1) × 360/n degrees, measured clockwise from the top.
 */
export function sliceAt(rotation: number, n: number): number {
  const under = (((-rotation % 360) + 360) % 360) / (360 / n);
  return Math.min(n - 1, Math.floor(under));
}

/**
 * Where to stop so slice `index` sits under the pointer: at least `turns` full turns past `from`, landing at
 * `offset` (0–1, kept away from the edges) across the slice so it never stops on a line.
 */
export function spinTarget(from: number, index: number, n: number, turns: number, offset: number): number {
  const slice = 360 / n;
  const at = (index + 0.15 + 0.7 * offset) * slice;
  const goal = -at;
  const delta = (((goal - from) % 360) + 360) % 360;
  return from + turns * 360 + delta;
}
