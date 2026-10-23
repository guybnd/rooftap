import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAVE_ALERT_MINUTES,
  LEAVE_ALERT_OPTIONS,
  LEAVE_BUFFER_MINUTES,
  leaveAlertMinutes,
  leaveAt,
  travelHint,
  travelText,
  type TravelMode,
} from './event-travel';
// notify-leave-time's pure half.
import * as twin from '../../../../../supabase/functions/_shared/event-travel';

const MELB = 'Australia/Melbourne';
// 7:30pm 26 Oct, Melbourne.
const START = '2026-10-26T08:30:00Z';

function ev(extra: Partial<twin.TravelEvent> = {}): twin.TravelEvent {
  return { title: 'Gig', starts_at: START, location: 'Forum', travel_mode: 'drive', travel_minutes: 28, ...extra };
}

describe('leave time', () => {
  it('leaves the travel time plus a buffer before the start, the same on both sides', () => {
    expect(twin.LEAVE_BUFFER_MINUTES).toBe(LEAVE_BUFFER_MINUTES);
    expect(leaveAt(START, 28).toISOString()).toBe('2026-10-26T07:52:00.000Z');
    expect(twin.leaveAt(START, 28).toISOString()).toBe(leaveAt(START, 28).toISOString());
  });

  it('words travel time the same on both sides', () => {
    for (const [m, mode] of [[28, 'drive'], [65, 'walk'], [120, 'cycle'], [0.2, 'drive']] as [number, TravelMode][]) {
      expect(twin.travelText(m, mode)).toBe(travelText(m, mode));
    }
    expect(travelText(65, 'walk')).toBe('1 hr 5 min walking');
    expect(travelText(120, 'cycle')).toBe('2 hr by bike');
  });
});

describe('leavePushDue', () => {
  // Leave by 7:52 (UTC), so an hour's alert is due at 6:52 and 30 minutes' at 7:22.
  it('fires its lead time before leaving, within the five-minute run window', () => {
    expect(twin.leavePushDue(ev(), new Date('2026-10-26T06:46:00Z'), 60, null)).toBe(false);
    expect(twin.leavePushDue(ev(), new Date('2026-10-26T06:47:00Z'), 60, null)).toBe(true);
    expect(twin.leavePushDue(ev(), new Date('2026-10-26T06:47:00Z'), 30, null)).toBe(false);
    expect(twin.leavePushDue(ev(), new Date('2026-10-26T07:17:00Z'), 30, null)).toBe(true);
    // Late (an event added after its alert time) but before the start still fires.
    expect(twin.leavePushDue(ev(), new Date('2026-10-26T08:20:00Z'), 60, null)).toBe(true);
  });

  it('stays quiet once pushed for this start, after the start, or with travel off', () => {
    const now = new Date('2026-10-26T07:00:00Z');
    expect(twin.leavePushDue(ev(), now, 60, START)).toBe(false);
    expect(twin.leavePushDue(ev(), now, 60, '2026-10-26T07:30:00Z')).toBe(true);
    expect(twin.leavePushDue(ev(), new Date('2026-10-26T08:31:00Z'), 60, null)).toBe(false);
    expect(twin.leavePushDue(ev({ travel_mode: null }), now, 60, null)).toBe(false);
    expect(twin.leavePushDue(ev({ travel_minutes: null }), now, 60, null)).toBe(false);
  });

  it('reads the lead time the same on both sides, an hour by default', () => {
    expect(twin.DEFAULT_LEAVE_ALERT_MINUTES).toBe(DEFAULT_LEAVE_ALERT_MINUTES);
    expect(twin.MAX_LEAVE_ALERT_MINUTES).toBe(Math.max(...LEAVE_ALERT_OPTIONS.map((o) => o.value)));
    for (const v of [null, undefined, 30, 60, 45]) {
      expect(twin.leaveAlertMinutes(v)).toBe(leaveAlertMinutes({ leave_alert_minutes: v }));
    }
    expect(leaveAlertMinutes(null)).toBe(60);
    expect(leaveAlertMinutes({ leave_alert_minutes: 30 })).toBe(30);
  });
});

describe('leavePushPayload', () => {
  it('says when to leave, how long, and where', () => {
    expect(twin.leavePushPayload(ev(), MELB)).toEqual({
      title: 'Leave by 6:52pm for Gig',
      body: '28 min by car to Forum, starts 7:30pm',
    });
  });
});

describe('travelHint', () => {
  const base = { mode: 'drive' as const, hasHome: true, hasPlace: true, minutes: 28, startsAt: START, formatClock: (d: Date) => d.toISOString().slice(11, 16) };
  it('says when to leave', () => {
    expect(travelHint(base)).toBe("28 min by car. Leave by 07:52; you'll get a push an hour before.");
    expect(travelHint({ ...base, alertMinutes: 30 })).toBe("28 min by car. Leave by 07:52; you'll get a push 30 min before.");
  });
  it('explains what is missing', () => {
    expect(travelHint({ ...base, mode: null })).toBeUndefined();
    expect(travelHint({ ...base, hasHome: false })).toMatch(/home address/);
    expect(travelHint({ ...base, hasPlace: false })).toMatch(/Add a location/);
    expect(travelHint({ ...base, minutes: undefined })).toMatch(/Working out/);
    expect(travelHint({ ...base, minutes: null })).toMatch(/Couldn't/);
  });
});
