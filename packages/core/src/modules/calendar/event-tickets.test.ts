import { describe, expect, it } from 'vitest';
import { findEventTicketsFolder, linkableEvents } from './event-tickets';
import type { DocumentFolder, GroupEvent } from '../../types';

const folder = (id: string, name: string, parent_id: string | null = null): DocumentFolder => ({
  id,
  group_id: 'g',
  name,
  parent_id,
  created_by: 'u',
  created_at: '',
  updated_at: '',
});

describe('findEventTicketsFolder', () => {
  it('finds the top-level folder by name, any case', () => {
    expect(findEventTicketsFolder([folder('a', 'Receipts'), folder('b', ' event Tickets ')])?.id).toBe('b');
  });
  it('ignores a nested folder of the same name', () => {
    expect(findEventTicketsFolder([folder('a', 'Event tickets', 'p')])).toBeNull();
  });
});

const ev = (id: string, starts_at: string, extra: Partial<GroupEvent> = {}) =>
  ({ id, starts_at, ends_at: null, deleted: false, private: false, created_by: 'u', ...extra }) as GroupEvent;

describe('linkableEvents', () => {
  const now = new Date(2026, 9, 19, 15, 0);
  it('keeps today and later, soonest first', () => {
    const events = [
      ev('later', new Date(2026, 9, 25, 10).toISOString()),
      ev('this-morning', new Date(2026, 9, 19, 9).toISOString()),
      ev('yesterday', new Date(2026, 9, 18, 9).toISOString()),
    ];
    expect(linkableEvents(events, 'u', now).map((e) => e.id)).toEqual(['this-morning', 'later']);
  });
  it("leaves out someone else's private event and deleted ones", () => {
    const at = new Date(2026, 9, 20, 9).toISOString();
    const events = [ev('mine', at, { private: true }), ev('theirs', at, { private: true, created_by: 'x' }), ev('gone', at, { deleted: true })];
    expect(linkableEvents(events, 'u', now).map((e) => e.id)).toEqual(['mine']);
  });
});
