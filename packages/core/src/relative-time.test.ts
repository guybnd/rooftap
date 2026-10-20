import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeUntil } from './relative-time';

describe('timeUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for missing, invalid or past dates', () => {
    expect(timeUntil(null)).toBeNull();
    expect(timeUntil('not a date')).toBeNull();
    expect(timeUntil('2026-10-18T23:59:00.000Z')).toBeNull();
  });

  it('formats minutes, hours and days ahead', () => {
    expect(timeUntil('2026-10-19T00:10:00.000Z')).toBe('in 10m');
    expect(timeUntil('2026-10-19T05:00:00.000Z')).toBe('in 5h');
    expect(timeUntil('2027-01-17T00:00:00.000Z')).toBe('in 90d');
  });
});
