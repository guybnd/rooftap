import { describe, expect, it } from 'vitest';
import { compareCreatedAt, compareStrings } from './sort';

describe('compareStrings', () => {
  it('orders plain strings like localeCompare', () => {
    expect(compareStrings('apple', 'banana')).toBeLessThan(0);
    expect(compareStrings('banana', 'apple')).toBeGreaterThan(0);
    expect(compareStrings('apple', 'apple')).toBe(0);
  });

  it('never throws when either or both sides are undefined/null', () => {
    expect(() => compareStrings(undefined, 'a')).not.toThrow();
    expect(() => compareStrings('a', undefined)).not.toThrow();
    expect(() => compareStrings(null, null)).not.toThrow();
    expect(() => compareStrings(undefined, undefined)).not.toThrow();
  });

  it('sorts missing values before non-empty strings', () => {
    expect(compareStrings(undefined, 'a')).toBeLessThan(0);
    expect(compareStrings('a', null)).toBeGreaterThan(0);
    expect(compareStrings(undefined, null)).toBe(0);
  });

  it('is safe as an Array.sort comparator over sparse rows', () => {
    const rows = [{ title: 'b' }, { title: undefined }, { title: 'a' }] as Array<{ title?: string }>;
    const sorted = [...rows].sort((a, b) => compareStrings(a.title, b.title));
    expect(sorted.map((r) => r.title)).toEqual([undefined, 'a', 'b']);
  });
});

describe('compareCreatedAt', () => {
  it('orders stamped rows oldest first', () => {
    expect(compareCreatedAt('2026-01-01', '2026-02-01')).toBeLessThan(0);
    expect(compareCreatedAt('2026-02-01', '2026-01-01')).toBeGreaterThan(0);
  });

  it('puts a row the server has not stamped yet (null) last, as the newest', () => {
    const rows = [{ created_at: null }, { created_at: '2026-02-01' }, { created_at: '2026-01-01' }] as Array<{ created_at: string | null }>;
    const sorted = [...rows].sort((a, b) => compareCreatedAt(a.created_at, b.created_at));
    expect(sorted.map((r) => r.created_at)).toEqual(['2026-01-01', '2026-02-01', null]);
    expect(compareCreatedAt(null, undefined)).toBe(0);
  });
});
