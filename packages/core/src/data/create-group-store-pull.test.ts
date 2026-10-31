// A full pull (first load, or the daily resetLastSync re-pull) must not leave
// soft-deleted rows in the store. Legend applies a full pull in 'set' mode,
// where a tombstone becomes a bare Symbol(delete) value instead of a removal,
// and Home drew each one as a blank "Task · Med" row with no date.
import { describe, expect, it } from 'vitest';
import { syncState, when } from '@legendapp/state';
import { configureStoreEnvironment } from './store-environment';
import { createGroupStore } from './create-group-store';

interface Row {
  id: string;
  group_id: string;
  title: string;
  deleted: boolean;
  created_at: string;
  updated_at: string;
}

const rows: Row[] = [
  { id: 'kept', group_id: 'g', title: 'Bins', deleted: false, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
  { id: 'gone', group_id: 'g', title: 'Old', deleted: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
];

function query() {
  const filters: ((r: Row) => boolean)[] = [];
  const builder = {
    select: () => builder,
    eq: (field: keyof Row, value: unknown) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    gt: (field: keyof Row, value: string) => {
      filters.push((r) => r[field] > value);
      return builder;
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(resolve, reject),
  };
  return builder;
}

const channel = () => {
  const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} };
  return c;
};

configureStoreEnvironment({
  supabase: { from: query, channel } as never,
  // No persistence: the bug is in what the pull writes to the live store.
  getPersistConfig: () => ({}),
  isOnline: () => true,
  isForeground: () => true,
  subscribeReconnect: () => () => {},
  subscribeForeground: () => () => {},
  keyValue: { getItem: () => null, setItem: () => {} },
  randomUUID: () => 'id',
});

describe('createGroupStore full pull', () => {
  it('leaves no value for a soft-deleted row, on first load or on a reset pull', async () => {
    const store$ = createGroupStore<Row>({ collection: 'household_tasks', storageName: 'household_tasks' })('g');
    store$.get();
    const state$ = syncState(store$);
    await when(() => state$.isLoaded.get());
    expect(Object.keys(store$.peek() ?? {})).toEqual(['kept']);

    await state$.sync({ resetLastSync: true });
    expect(Object.keys(store$.peek() ?? {})).toEqual(['kept']);
    expect(Object.values(store$.peek() ?? {}).every((r) => typeof r === 'object')).toBe(true);
  });
});
