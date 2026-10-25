import { describe, expect, it } from 'vitest';
import { backlogSlots } from '../../packages/shared/src/backlog.js';

const row = (title: string, status: string, created: string, updated = created) =>
  ({ media: { title, type: 'GAME' }, entry: { id: title, status, created_at: created, updated_at: updated } }) as any;

describe('home page backlog slots', () => {
  it('in-progress first (most recently touched), then most recently added; never completed or dropped; max 5', () => {
    const rows = [
      row('old planned', 'PLANNED', '2026-01-01'),
      row('new planned', 'PLANNED', '2026-10-20'),
      row('newest planned', 'PLANNED', '2026-10-24'),
      row('paused', 'PAUSED', '2026-10-10'),
      row('playing a while', 'IN_PROGRESS', '2025-05-01', '2026-10-01'),
      row('playing now', 'IN_PROGRESS', '2024-01-01', '2026-10-25'),
      row('finished', 'COMPLETED', '2026-10-25'),
      row('gave up', 'DROPPED', '2026-10-25'),
    ];
    expect(backlogSlots(rows).map((r) => r.media.title)).toEqual(['playing now', 'playing a while', 'newest planned', 'new planned', 'paused']);
  });
});
