import { describe, expect, it } from 'vitest';
import { compareStrings } from './sort';

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
