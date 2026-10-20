import { describe, it, expect } from 'vitest';
import { CURRENCY_BY_COUNTRY } from './currency-by-country';
import { getRegionProvider, listRegions, hasCuratedContent, DEFAULT_REGION } from './index';

describe('currency-by-country', () => {
  // The whole point of the table is that a household in any country gets money
  // formatted correctly. A typo'd currency code makes Intl throw at render
  // time, so catch it here instead.
  it('maps every country to a currency Intl actually accepts', () => {
    const supported = new Set(Intl.supportedValuesOf('currency'));
    const unknown = Object.entries(CURRENCY_BY_COUNTRY)
      .filter(([, code]) => !supported.has(code))
      .map(([country, code]) => `${country} -> ${code}`);
    expect(unknown).toEqual([]);
  });

  it('keys are ISO 3166-1 alpha-2 shaped, matching the DB check constraint', () => {
    const malformed = Object.keys(CURRENCY_BY_COUNTRY).filter((c) => !/^[A-Z]{2}$/.test(c));
    expect(malformed).toEqual([]);
  });
});

describe('getRegionProvider', () => {
  it('returns curated content for a curated country', () => {
    expect(getRegionProvider('AU').groceryStaples.length).toBeGreaterThan(0);
    expect(getRegionProvider('DE').movingTasks.length).toBeGreaterThan(0);
    expect(getRegionProvider('DE').currency.code).toBe('EUR');
  });

  it('serves an uncurated country with correct currency and empty local content', () => {
    const jp = getRegionProvider('JP');
    expect(jp.id).toBe('JP');
    expect(jp.currency.code).toBe('JPY');
    // Empty rather than guessed: callers already gate on these being non-empty.
    expect(jp.groceryStaples).toEqual([]);
    expect(jp.movingTasks).toEqual([]);
    // Expense categories aren't country-specific, so they're still offered.
    expect(jp.expenseCategories.length).toBeGreaterThan(0);
  });

  it('formats money for an uncurated country', () => {
    const formatted = getRegionProvider('JP').currency.format(1234);
    expect(formatted).toContain('1,234');
  });

  it('is case insensitive and caches generic providers', () => {
    expect(getRegionProvider('jp').id).toBe('JP');
    expect(getRegionProvider('JP')).toBe(getRegionProvider('JP'));
  });

  it('falls back to the default region for missing or malformed input', () => {
    expect(getRegionProvider(undefined).id).toBe(DEFAULT_REGION);
    expect(getRegionProvider('').id).toBe(DEFAULT_REGION);
    expect(getRegionProvider('NOPE').id).toBe(DEFAULT_REGION);
  });

  it('reports which countries carry curated content', () => {
    expect(hasCuratedContent('AU')).toBe(true);
    expect(hasCuratedContent('DE')).toBe(true);
    expect(hasCuratedContent('JP')).toBe(false);
    expect(hasCuratedContent(undefined)).toBe(false);
  });
});

describe('listRegions', () => {
  it('offers every country in the currency table, named and sorted', () => {
    const regions = listRegions('en');
    expect(regions.length).toBe(Object.keys(CURRENCY_BY_COUNTRY).length);

    const de = regions.find((r) => r.id === 'DE');
    expect(de).toMatchObject({ name: 'Germany', currency: 'EUR', curated: true });
    expect(regions.find((r) => r.id === 'JP')).toMatchObject({ curated: false });

    const names = regions.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('resolves a real name for every country, never bare codes', () => {
    const unnamed = listRegions('en').filter((r) => r.name === r.id);
    expect(unnamed).toEqual([]);
  });
});
