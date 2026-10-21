import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney } from './costs';
import {
  FOLLOW_REGION_CURRENCY,
  currencyPickerOptions,
  currencySymbol,
  getHouseholdCurrency,
  setHouseholdCurrency,
} from './currency';
import { DEFAULT_CURRENCY, householdCurrency } from './household-currency';

afterEach(() => setHouseholdCurrency(DEFAULT_CURRENCY));

describe('householdCurrency', () => {
  it("follows the region when the household hasn't picked one", () => {
    expect(householdCurrency({ region: 'DE', currency: null })).toBe('EUR');
    expect(householdCurrency({ region: 'AU' })).toBe('AUD');
  });

  it('prefers an explicit pick over the region', () => {
    expect(householdCurrency({ region: 'AU', currency: 'ILS' })).toBe('ILS');
  });

  it('falls back to AUD with no household', () => {
    expect(householdCurrency(null)).toBe(DEFAULT_CURRENCY);
  });
});

describe('formatMoney', () => {
  it('formats AUD as before', () => {
    expect(formatMoney(123456)).toBe('$1,235');
  });

  it("uses the household currency's own symbol", () => {
    setHouseholdCurrency('EUR');
    expect(formatMoney(1200)).toBe('€12');
    setHouseholdCurrency('GBP');
    expect(formatMoney(1200)).toBe('£12');
  });

  it('takes an explicit currency over the household one', () => {
    setHouseholdCurrency('EUR');
    expect(formatMoney(1200, { currency: 'ILS' })).toBe('₪12');
  });
});

describe('setHouseholdCurrency', () => {
  it('ignores malformed codes', () => {
    setHouseholdCurrency('euro');
    expect(getHouseholdCurrency()).toBe(DEFAULT_CURRENCY);
  });
});

describe('currencySymbol', () => {
  it('gives the input prefix for the household currency', () => {
    expect(currencySymbol()).toBe('$');
    setHouseholdCurrency('JPY');
    expect(currencySymbol()).toBe('¥');
  });
});

describe('currencyPickerOptions', () => {
  it('leads with "same as region", then every currency once', () => {
    const options = currencyPickerOptions('AUD');
    expect(options[0]).toMatchObject({ value: FOLLOW_REGION_CURRENCY, secondary: 'AUD' });
    const codes = options.slice(1).map((o) => o.value);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('EUR');
    expect(codes).toContain('USD');
  });
});
