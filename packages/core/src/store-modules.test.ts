import { describe, expect, it } from 'vitest';
import * as stores from './data/stores';
import { ALL_MODULE_IDS, type ModuleId } from './modules';
import { STORE_MODULES, isStoreSynced, syncedGroupId, type StoreCollection } from './store-modules';

const ALL_STORES = Object.values(stores).filter(
  (s): s is typeof stores.householdTasks$ => typeof s === 'function' && 'collection' in s,
);
const COLLECTIONS = Object.keys(STORE_MODULES) as StoreCollection[];
const allOn = new Set<string>(ALL_MODULE_IDS);
const allOnBut = (...off: ModuleId[]) => new Set<string>(ALL_MODULE_IDS.filter((m) => !off.includes(m)));

describe('store modules', () => {
  it('maps every synced group table, and only those', () => {
    expect(ALL_STORES.length).toBeGreaterThan(0);
    expect(ALL_STORES.map((s) => s.collection).sort()).toEqual([...COLLECTIONS].sort());
  });

  it('names only real modules', () => {
    for (const c of COLLECTIONS) for (const m of STORE_MODULES[c]) expect(ALL_MODULE_IDS, c).toContain(m);
  });

  it('syncs every table with every module on, and none with every module off', () => {
    for (const c of COLLECTIONS) {
      expect([c, isStoreSynced(c, allOn)]).toEqual([c, true]);
      expect([c, isStoreSynced(c, new Set())]).toEqual([c, false]);
    }
  });

  it.each(ALL_MODULE_IDS)('turning %s off stops only the tables nothing else uses', (off) => {
    const on = allOnBut(off);
    for (const c of COLLECTIONS) {
      const others = (STORE_MODULES[c] as readonly string[]).filter((m) => m !== off);
      expect([c, isStoreSynced(c, on)]).toEqual([c, others.length > 0]);
    }
  });

  it('keeps tasks syncing for bill and document reminders with Tasks off', () => {
    expect(isStoreSynced('household_tasks', allOnBut('household'))).toBe(true);
    expect(isStoreSynced('household_tasks', allOnBut('household', 'costs'))).toBe(true);
    expect(isStoreSynced('household_tasks', allOnBut('household', 'costs', 'documents'))).toBe(false);
  });

  it('syncs a table no module claims', () => {
    expect(isStoreSynced('not_a_module_table', new Set())).toBe(true);
  });
});

describe('syncedGroupId', () => {
  it('passes the group through while a module of the store is on', () => {
    expect(syncedGroupId(stores.groceryItems$, 'g1', allOn)).toBe('g1');
  });

  it('gives no group (the inert store) once every module of the store is off', () => {
    expect(syncedGroupId(stores.groceryItems$, 'g1', allOnBut('groceries'))).toBeUndefined();
    expect(stores.groceryItems$(syncedGroupId(stores.groceryItems$, 'g1', allOnBut('groceries')))).toBe(
      stores.groceryItems$(undefined),
    );
  });

  it('gives no group without one', () => {
    expect(syncedGroupId(stores.groceryItems$, null, allOn)).toBeUndefined();
  });
});
