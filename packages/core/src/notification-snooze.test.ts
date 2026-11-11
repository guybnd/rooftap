import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNOOZE_MINUTES,
  SNOOZE_KINDS,
  normalizeSnoozePick,
  snoozeActionId,
  snoozeCategoryId,
  snoozeKindFromCategory,
  snoozeMinutesFor,
  snoozeMinutesFromAction,
  snoozeShortLabel,
  snoozeUntil,
  toggleSnoozePick,
} from './notification-snooze';
// The Edge Functions' half: the category each reminder push names.
import * as twin from '../../../supabase/functions/_shared/notification-snooze';

describe('notification snooze', () => {
  it('names the same categories as the Edge Functions', () => {
    expect([...twin.SNOOZE_KINDS]).toEqual([...SNOOZE_KINDS]);
    for (const kind of SNOOZE_KINDS) {
      expect(twin.snoozeCategoryId(kind)).toBe(snoozeCategoryId(kind));
      expect(snoozeKindFromCategory(snoozeCategoryId(kind))).toBe(kind);
    }
    expect(snoozeKindFromCategory('snooze-nope')).toBeNull();
    expect(snoozeKindFromCategory(undefined)).toBeNull();
  });

  it('reads the minutes back from a button', () => {
    expect(snoozeMinutesFromAction(snoozeActionId(60))).toBe(60);
    expect(snoozeMinutesFromAction('expo.modules.notifications.actions.DEFAULT')).toBeNull();
    expect(snoozeMinutesFromAction('snooze:abc')).toBeNull();
  });

  it('defaults to 1 hour, 1 day and 1 week', () => {
    expect(normalizeSnoozePick(undefined)).toEqual([60, 1440, 10080]);
    expect(normalizeSnoozePick([])).toEqual([...DEFAULT_SNOOZE_MINUTES]);
    expect(normalizeSnoozePick([7, 'x'])).toEqual([...DEFAULT_SNOOZE_MINUTES]);
  });

  it('keeps a pick to three known choices, shortest first', () => {
    expect(normalizeSnoozePick([1440, 15, 15, 99])).toEqual([15, 1440]);
    expect(normalizeSnoozePick([10080, 2880, 1440, 60])).toEqual([60, 1440, 2880]);
  });

  it('toggles a choice without going below one or above three', () => {
    expect(toggleSnoozePick([60, 1440, 10080], 30)).toEqual([60, 1440, 10080]);
    expect(toggleSnoozePick([60, 1440], 30)).toEqual([30, 60, 1440]);
    expect(toggleSnoozePick([60, 1440], 60)).toEqual([1440]);
    expect(toggleSnoozePick([60], 60)).toEqual([60]);
  });

  it('gives leave alerts and bin night short fixed buttons', () => {
    expect(snoozeMinutesFor('task', [30, 180])).toEqual([30, 180]);
    expect(snoozeMinutesFor('event', [])).toEqual([60, 1440, 10080]);
    expect(snoozeMinutesFor('leave', [30, 180])).toEqual([5, 10, 15]);
    expect(snoozeMinutesFor('bins', [30, 180])).toEqual([30, 60, 120]);
    expect(snoozeMinutesFor('bins', []).map(snoozeShortLabel)).toEqual(['30m', '1h', '2h']);
    expect(snoozeMinutesFor('leave', []).map(snoozeShortLabel)).toEqual(['5m', '10m', '15m']);
  });

  it('never brings an event reminder back after the event', () => {
    const now = new Date('2026-11-10T09:00:00Z');
    expect(snoozeUntil(now, 60).toISOString()).toBe('2026-11-10T10:00:00.000Z');
    // A week on a reminder the day before comes back an hour before the start.
    expect(snoozeUntil(now, 10080, '2026-11-11T09:00:00Z').toISOString()).toBe('2026-11-11T08:00:00.000Z');
    // Already inside the hour: back in five minutes, not in the past.
    expect(snoozeUntil(now, 1440, '2026-11-10T09:30:00Z').toISOString()).toBe('2026-11-10T09:05:00.000Z');
    expect(snoozeUntil(now, 60, 'not a date').toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });
});
