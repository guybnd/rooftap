import { describe, expect, it } from 'vitest';
import { documentFileLimit, documentStorageLimit, entitlementTier, DOCUMENT_FILE_LIMITS } from './entitlements';

const now = new Date('2026-10-20T00:00:00Z');

describe('entitlementTier', () => {
  it('treats a household with no row as free', () => {
    expect(entitlementTier(null, now)).toBe('free');
  });

  it('puts a comped household above every plan', () => {
    expect(entitlementTier({ plan: 'free', plan_expires_at: null, billing_exempt: true }, now)).toBe('exempt');
  });

  it('honours Plus until it expires', () => {
    expect(entitlementTier({ plan: 'plus', plan_expires_at: null, billing_exempt: false }, now)).toBe('plus');
    expect(entitlementTier({ plan: 'plus', plan_expires_at: '2026-11-01T00:00:00Z', billing_exempt: false }, now)).toBe('plus');
    expect(entitlementTier({ plan: 'plus', plan_expires_at: '2026-10-01T00:00:00Z', billing_exempt: false }, now)).toBe('free');
  });
});

describe('documentFileLimit', () => {
  it('grows with the tier and never exceeds R2 single-upload size', () => {
    expect(documentFileLimit(null, now)).toEqual(DOCUMENT_FILE_LIMITS.free);
    expect(DOCUMENT_FILE_LIMITS.free.bytes).toBeLessThan(DOCUMENT_FILE_LIMITS.plus.bytes);
    expect(DOCUMENT_FILE_LIMITS.plus.bytes).toBeLessThan(DOCUMENT_FILE_LIMITS.exempt.bytes);
    expect(DOCUMENT_FILE_LIMITS.exempt.bytes).toBeLessThanOrEqual(5 * 1024 ** 3);
  });
});

describe('documentStorageLimit', () => {
  it('caps Free and Plus households and leaves comped ones unlimited', () => {
    expect(documentStorageLimit(null, now)?.label).toBe('2 GB');
    expect(documentStorageLimit({ plan: 'plus', plan_expires_at: null, billing_exempt: false }, now)?.label).toBe('25 GB');
    expect(documentStorageLimit({ plan: 'free', plan_expires_at: null, billing_exempt: true }, now)).toBeNull();
  });
});
