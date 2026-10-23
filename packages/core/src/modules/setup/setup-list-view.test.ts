import { describe, expect, it } from 'vitest';
import type { SetupItem, SetupStore } from '../../types';
import { summarize } from './setup';
import {
  filterSetupItems,
  finishesSetupRoom,
  groupSetupByRoom,
  liveSetupItems,
  moveInRoom,
  reindexRoomOrder,
  setupCommentSummaries,
  setupDocLinks,
  setupHeroCaption,
  setupRoomNames,
  setupSeedNotice,
  setupStatusFiltersFor,
  setupStatusSegment,
  setupStoreTrip,
  topSetupRooms,
} from './setup-list-view';

function item(overrides: Partial<SetupItem> = {}): SetupItem {
  return {
    id: 'i1',
    group_id: 'g1',
    name: 'Lamp',
    room: 'Lounge',
    priority: 'medium',
    status: 'needed',
    est_price: null,
    actual_price: null,
    where_to_buy: null,
    store_id: null,
    url: null,
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    ai_suggestion: null,
    sort_order: 0,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

const money = (n: number) => `$${n}`;

describe('liveSetupItems', () => {
  it('drops deleted and empty rows and sorts by sort_order', () => {
    const rows = [item({ id: 'b', sort_order: 2 }), null, item({ id: 'x', deleted: true }), item({ id: 'a', sort_order: 1 })];
    expect(liveSetupItems(rows).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('filterSetupItems', () => {
  const items = [
    item({ id: 'a', room: 'Kitchen', store_id: 's1', status: 'needed', assigned_to: 'u1' }),
    item({ id: 'b', room: 'Lounge', store_id: 's2', status: 'installed', assigned_to: 'u2' }),
    item({ id: 'c', room: 'Kitchen', store_id: null, status: 'installed', assigned_to: null }),
  ];
  const none = { roomFilter: null, storeFilter: null, statusFilters: [], mineOnly: false };
  const ids = (list: SetupItem[]) => list.map((i) => i.id);

  it('keeps everything with no filters', () => {
    expect(ids(filterSetupItems(items, none, 'u1'))).toEqual(['a', 'b', 'c']);
  });

  it('filters by room, store, status and mine only', () => {
    expect(ids(filterSetupItems(items, { ...none, roomFilter: 'Kitchen' }, 'u1'))).toEqual(['a', 'c']);
    expect(ids(filterSetupItems(items, { ...none, storeFilter: 's2' }, 'u1'))).toEqual(['b']);
    expect(ids(filterSetupItems(items, { ...none, statusFilters: ['installed'] }, 'u1'))).toEqual(['b', 'c']);
    expect(ids(filterSetupItems(items, { ...none, mineOnly: true }, 'u1'))).toEqual(['a']);
  });
});

describe('room groups', () => {
  const items = [
    item({ id: 'a', room: 'Kitchen', status: 'needed', est_price: 10 }),
    item({ id: 'b', room: '', status: 'installed' }),
    item({ id: 'c', room: 'Kitchen', status: 'installed' }),
    item({ id: 'd', room: 'Bath', status: 'needed' }),
    item({ id: 'e', room: 'Bath', status: 'needed' }),
  ];

  it('groups by room in first-seen order, with no room under Other', () => {
    const groups = groupSetupByRoom(items);
    expect(Array.from(groups.keys())).toEqual(['Kitchen', 'Other', 'Bath']);
    expect(groups.get('Kitchen')!.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('lists named rooms alphabetically, without duplicates or blanks', () => {
    expect(setupRoomNames(items)).toEqual(['Bath', 'Kitchen']);
  });

  it('picks the rooms with the most still to get, then the largest', () => {
    expect(topSetupRooms(items).map((r) => r.room)).toEqual(['Bath', 'Kitchen']);
    expect(topSetupRooms(items, 3).map((r) => [r.room, r.outstanding])).toEqual([
      ['Bath', 2],
      ['Kitchen', 1],
      ['Other', 0],
    ]);
  });

  it('knows when an install finishes a room', () => {
    expect(finishesSetupRoom(items, items[0])).toBe(true);
    expect(finishesSetupRoom(items, items[3])).toBe(false);
    // A room of one has no siblings to finish with.
    expect(finishesSetupRoom([item({ id: 'solo' })], item({ id: 'solo' }))).toBe(false);
  });
});

describe('setupStoreTrip', () => {
  const stores = [{ id: 's1', name: 'Ikea' }] as SetupStore[];
  const filtered = [item({ est_price: 20 }), item({ id: 'i2', status: 'installed', est_price: 5 })];

  it('is null with no store filter', () => {
    expect(setupStoreTrip(filtered, null, stores)).toBeNull();
  });

  it('rolls up the filtered items under the store name', () => {
    expect(setupStoreTrip(filtered, 's1', stores)).toEqual({ ...summarize(filtered), storeName: 'Ikea' });
    expect(setupStoreTrip(filtered, 'gone', stores)?.storeName).toBe('Store');
  });
});

describe('setupHeroCaption', () => {
  it('is empty with no items', () => {
    expect(setupHeroCaption(summarize([]), money)).toBeUndefined();
  });

  it('says how many are done and what was spent', () => {
    const items = [item({ status: 'installed', actual_price: 30 }), item({ id: 'i2' })];
    expect(setupHeroCaption(summarize(items), money)).toBe('1 done · $30 spent');
  });

  it('says all set up when nothing is left', () => {
    expect(setupHeroCaption(summarize([item({ status: 'installed' })]), money)).toBe('All set up');
  });

  it('has no caption when nothing is done or spent', () => {
    expect(setupHeroCaption(summarize([item()]), money)).toBeUndefined();
  });
});

describe('status segment', () => {
  it('maps the stored filter list to a segment and back', () => {
    expect(setupStatusSegment([])).toBe('all');
    expect(setupStatusSegment(['installed'])).toBe('installed');
    expect(setupStatusSegment(['needed', 'installed'])).toBe('all');
    expect(setupStatusFiltersFor('all')).toEqual([]);
    expect(setupStatusFiltersFor('needed')).toEqual(['needed']);
  });
});

describe('setupSeedNotice', () => {
  it('counts the starter items', () => {
    expect(setupSeedNotice(1)).toBe('Added 1 starter item.');
    expect(setupSeedNotice(4)).toBe('Added 4 starter items.');
    expect(setupSeedNotice(0)).toBe('Starter items are already in your list.');
  });
});

describe('reorder', () => {
  it('reindexes a room to contiguous 0..n', () => {
    expect(reindexRoomOrder(['c', 'a', 'b'])).toEqual([
      { id: 'c', sort_order: 0 },
      { id: 'a', sort_order: 1 },
      { id: 'b', sort_order: 2 },
    ]);
    expect(reindexRoomOrder([])).toEqual([]);
  });

  it('moves an item within its room', () => {
    const room = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveInRoom(room, 0, 2).map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(moveInRoom(room, 2, 1).map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(moveInRoom(room, 1, 0).map((p) => p.sort_order)).toEqual([0, 1, 2]);
  });

  it('does nothing out of range or in place', () => {
    const room = [{ id: 'a' }, { id: 'b' }];
    expect(moveInRoom(room, 0, -1)).toEqual([]);
    expect(moveInRoom(room, 1, 2)).toEqual([]);
    expect(moveInRoom(room, -1, 0)).toEqual([]);
    expect(moveInRoom(room, 1, 1)).toEqual([]);
  });
});

describe('row portals', () => {
  it('counts comments and keeps the newest', () => {
    const rows = [
      { setup_item_id: 'a', content: 'newest', user_id: 'u1', created_at: '2026-10-03' },
      { setup_item_id: 'b', content: 'only', user_id: 'u2', created_at: '2026-10-02' },
      { setup_item_id: 'a', content: 'older', user_id: 'u2', created_at: '2026-10-01' },
    ];
    expect(setupCommentSummaries(rows)).toEqual({
      a: { count: 2, latest: { content: 'newest', user_id: 'u1', created_at: '2026-10-03' } },
      b: { count: 1, latest: { content: 'only', user_id: 'u2', created_at: '2026-10-02' } },
    });
  });

  it('keeps the newest linked document per item and skips missing ones', () => {
    const rows = [
      { entity_id: 'a', documents: null },
      { entity_id: 'a', documents: { storage_path: 'p/new', source: 'warranty' as const } },
      { entity_id: 'a', documents: { storage_path: 'p/old', source: 'other' as const } },
    ];
    expect(setupDocLinks(rows)).toEqual({ a: { storagePath: 'p/new', source: 'warranty' } });
  });
});
