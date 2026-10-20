import { describe, expect, it } from 'vitest';
import {
  compareByAdded,
  compareByName,
  matchesFilters,
  parseDaysField,
  parsePriceField,
  type MergedEntry,
} from './shelf-life-logic';

function entry(overrides: Partial<MergedEntry> & { name: string }): MergedEntry {
  return {
    aisle: 'other',
    effectiveDays: null,
    effectivePriceCents: null,
    isOverridden: false,
    isCustom: false,
    hidden: false,
    created_at: null,
    ...overrides,
  };
}

describe('parseDaysField', () => {
  it('clears to null on empty/whitespace input', () => {
    expect(parseDaysField('')).toEqual({ value: null, valid: true });
    expect(parseDaysField('   ')).toEqual({ value: null, valid: true });
  });

  it('accepts 0 as a valid value', () => {
    expect(parseDaysField('0')).toEqual({ value: 0, valid: true });
  });

  it('truncates fractional input', () => {
    expect(parseDaysField('12.7')).toEqual({ value: 12, valid: true });
  });

  it('rejects negative or non-numeric input', () => {
    expect(parseDaysField('-1')).toEqual({ value: null, valid: false });
    expect(parseDaysField('abc')).toEqual({ value: null, valid: false });
  });
});

describe('parsePriceField', () => {
  it('clears to null on empty input', () => {
    expect(parsePriceField('')).toEqual({ value: null, valid: true });
  });

  it('accepts 0 as a valid value', () => {
    expect(parsePriceField('0')).toEqual({ value: 0, valid: true });
  });

  it('rounds fractional cents', () => {
    expect(parsePriceField('1.256')).toEqual({ value: 126, valid: true });
  });

  it('rejects negative or non-numeric input', () => {
    expect(parsePriceField('-1')).toEqual({ value: null, valid: false });
    expect(parsePriceField('abc')).toEqual({ value: null, valid: false });
  });
});

describe('compareByAdded', () => {
  it('falls back to name order when all created_at are null', () => {
    const entries = [entry({ name: 'Bananas' }), entry({ name: 'Apples' }), entry({ name: 'Carrots' })];
    expect(entries.sort(compareByAdded).map((e) => e.name)).toEqual(['Apples', 'Bananas', 'Carrots']);
  });

  it('sorts null created_at entries after timestamped ones', () => {
    const entries = [
      entry({ name: 'NoDate' }),
      entry({ name: 'Older', created_at: '2026-01-01T00:00:00.000Z' }),
      entry({ name: 'Newer', created_at: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(entries.sort(compareByAdded).map((e) => e.name)).toEqual(['Newer', 'Older', 'NoDate']);
  });

  it('tie-breaks equal timestamps by name', () => {
    const entries = [
      entry({ name: 'Zebra', created_at: '2026-01-01T00:00:00.000Z' }),
      entry({ name: 'Apple', created_at: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(entries.sort(compareByAdded).map((e) => e.name)).toEqual(['Apple', 'Zebra']);
  });
});

describe('compareByName', () => {
  it('sorts by name regardless of created_at', () => {
    const entries = [
      entry({ name: 'Bananas', created_at: '2026-01-01T00:00:00.000Z' }),
      entry({ name: 'Apples', created_at: null }),
    ];
    expect(entries.sort(compareByName).map((e) => e.name)).toEqual(['Apples', 'Bananas']);
  });
});

describe('matchesFilters', () => {
  const base = { search: '', showHidden: false, customOnly: false, aisleFilter: null as string | null };

  it('excludes hidden entries unless showHidden is true', () => {
    const hidden = entry({ name: 'Milk', hidden: true });
    expect(matchesFilters(hidden, base)).toBe(false);
    expect(matchesFilters(hidden, { ...base, showHidden: true })).toBe(true);
  });

  it('matches search case-insensitively against the name', () => {
    const item = entry({ name: 'Almond Milk' });
    expect(matchesFilters(item, { ...base, search: 'milk' })).toBe(true);
    expect(matchesFilters(item, { ...base, search: 'MILK' })).toBe(true);
    expect(matchesFilters(item, { ...base, search: 'bread' })).toBe(false);
  });

  it('restricts to the aisle filter when set', () => {
    const item = entry({ name: 'Milk', aisle: 'dairy' });
    expect(matchesFilters(item, { ...base, aisleFilter: 'dairy' })).toBe(true);
    expect(matchesFilters(item, { ...base, aisleFilter: 'produce' })).toBe(false);
  });

  it('ANDs customOnly with every other filter, including a hidden custom row', () => {
    const hiddenCustom = entry({ name: 'Special Sauce', isCustom: true, hidden: true });
    // customOnly alone doesn't override showHidden — a hidden custom row is
    // still excluded when showHidden is off.
    expect(matchesFilters(hiddenCustom, { ...base, customOnly: true })).toBe(false);
    expect(matchesFilters(hiddenCustom, { ...base, customOnly: true, showHidden: true })).toBe(true);

    const builtIn = entry({ name: 'Milk', isCustom: false });
    expect(matchesFilters(builtIn, { ...base, customOnly: true })).toBe(false);

    const custom = entry({ name: 'Special Sauce', isCustom: true });
    expect(matchesFilters(custom, { ...base, customOnly: true, search: 'sauce' })).toBe(true);
    expect(matchesFilters(custom, { ...base, customOnly: true, search: 'bread' })).toBe(false);
  });
});
