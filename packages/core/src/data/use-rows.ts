'use client';

// The one way a screen reads a synced store's rows.
//
// Two bug classes kept coming back from reading `Object.values(store$.get())`
// by hand:
//
// - Rows that are not what the type says. A local cache can hold a bare
//   Symbol(delete) after a full pull (#661), a partial row with no name
//   (#386, #483, #547) or a field of the wrong type (#653). Each fix guarded
//   one render site, and the next screen crashed the same way.
// - Identity. `use$(() => Object.values(...).filter(...))` builds a new array
//   on every render, so an effect or callback that depends on it runs on
//   every render: Docs reloaded twice a second (#630), Capture search
//   flickered (#671). A selector that returns the row object itself never
//   redraws, because Legend edits that object in place (#644).
//
// useRows skips unreadable and deleted rows, and returns the same array (and
// the same row objects) until a row really changes.
import { use$ } from '@legendapp/state/react';
import type { Observable } from '@legendapp/state';
import { useRef } from 'react';
import { storeRequiredFields, type GroupRecord, type SyncedRow } from './create-group-store';

function isReadable(value: unknown, required: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return false;
  for (const field of required) {
    if (row[field] === null || row[field] === undefined) return false;
  }
  return true;
}

/**
 * The rows of a store's record that are really there: objects with a string
 * id and every required field, and (unless `includeDeleted`) not deleted.
 */
export function readableRows<T extends { deleted?: boolean }>(
  record: Record<string, T | undefined> | null | undefined,
  required: readonly string[] = [],
  includeDeleted = false,
): T[] {
  const out: T[] = [];
  for (const value of Object.values(record ?? {})) {
    if (!isReadable(value, required)) continue;
    if (!includeDeleted && (value as T).deleted) continue;
    out.push(value as T);
  }
  return out;
}

/** A copy that shares nothing Legend can edit in place: nested values are cloned. */
function copyRow<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out as T;
}

function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function rowEqual(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!fieldEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * `next`, reusing what has not changed from `prev`: each row object that is
 * equal to the previous copy of the same id, and the whole array
 * when every row and the order are the same.
 */
export function stableRows<T extends { id: string }>(prev: readonly T[] | null, next: readonly T[]): T[] {
  if (!prev) return next as T[];
  const byId = new Map<string, T>();
  for (const row of prev) byId.set(row.id, row);
  let same = prev.length === next.length;
  const out = next.map((row, i) => {
    const old = byId.get(row.id);
    const kept = old && rowEqual(old, row) ? old : row;
    if (same && prev[i] !== kept) same = false;
    return kept;
  });
  return same ? (prev as T[]) : out;
}

export interface UseRowsOptions {
  /** Keep soft-deleted rows (an archive or a bin). */
  includeDeleted?: boolean;
}

/**
 * The store's readable rows, optionally narrowed by `where`. The result keeps
 * its identity until a row changes, so it is safe in effect and memo
 * dependency lists. Sort with useMemo on the result.
 */
export function useRows<T extends SyncedRow>(
  store$: Observable<GroupRecord<T>>,
  where?: (row: T) => boolean,
  options: UseRowsOptions = {},
): T[] {
  const required = storeRequiredFields(store$ as unknown as Observable<GroupRecord<SyncedRow>>);
  // Copies, so an edit Legend makes in place still shows as a change.
  const next = use$(() => {
    const rows = readableRows<T>(store$.get() as unknown as Record<string, T | undefined>, required, options.includeDeleted);
    return (where ? rows.filter(where) : rows).map(copyRow);
  });
  const prev = useRef<T[] | null>(null);
  const result = stableRows(prev.current, next);
  prev.current = result;
  return result;
}
