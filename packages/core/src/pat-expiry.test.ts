import { describe, expect, it } from 'vitest';
import { patExpiryDays } from './pat-expiry';

describe('patExpiryDays', () => {
  it('defaults to never', () => {
    expect(patExpiryDays(undefined)).toBeNull();
    expect(patExpiryDays(null)).toBeNull();
  });

  it('maps each choice to its lifetime', () => {
    expect(patExpiryDays('never')).toBeNull();
    expect(patExpiryDays('30')).toBe(30);
    expect(patExpiryDays('90')).toBe(90);
    expect(patExpiryDays('365')).toBe(365);
  });

  it('rejects anything else', () => {
    expect(patExpiryDays('7')).toBeUndefined();
    expect(patExpiryDays(90)).toBeUndefined();
    expect(patExpiryDays('forever')).toBeUndefined();
  });
});
