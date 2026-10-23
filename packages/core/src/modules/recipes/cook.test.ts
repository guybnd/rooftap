import { describe, expect, it } from 'vitest';
import {
  addTimerMinute,
  clampStep,
  cookBadge,
  cookInitials,
  nearestAcrossCooks,
  nearestTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  timerProgress,
  timerState,
  timersToRing,
  type CookSession,
  type CookTimer,
} from './cook';

const T0 = Date.parse('2026-10-23T18:00:00Z');
const input = { step: 1, index: 0, label: 'Simmer', seconds: 600 };

function session(timers: CookTimer[], step = 0): CookSession {
  return {
    id: 's1', group_id: 'g', user_id: 'u', recipe_id: 'r', step, timers,
    started_at: null, created_at: '', updated_at: '', deleted: false,
  };
}

describe('timers', () => {
  it('starts a timer that ends after its length, on this device', () => {
    const [t] = startTimer([], input, 'phone', T0);
    expect(t.endsAt).toBe(new Date(T0 + 600_000).toISOString());
    expect(t.deviceId).toBe('phone');
    expect(timerState(t, T0 + 1000)).toBe('running');
    expect(timerState(t, T0 + 600_000)).toBe('done');
    expect(timerProgress(t, T0 + 300_000)).toBeCloseTo(0.5);
  });

  it('does not start the same chip twice, but restarts a finished one', () => {
    const once = startTimer([], input, 'phone', T0);
    expect(startTimer(once, input, 'web', T0 + 1000)).toBe(once);
    const again = startTimer(once, input, 'web', T0 + 700_000);
    expect(again).toHaveLength(1);
    expect(again[0].deviceId).toBe('web');
    expect(again[0].id).toBe(once[0].id);
  });

  it('pauses, resumes and adds a minute', () => {
    const [t] = startTimer([], input, 'phone', T0);
    const paused = pauseTimer([t], t.id, T0 + 100_000);
    expect(timerState(paused[0], T0 + 900_000)).toBe('paused');
    expect(paused[0].pausedRemaining).toBe(500_000);
    const plus = addTimerMinute(paused, t.id, 'phone', T0);
    expect(plus[0].pausedRemaining).toBe(560_000);
    const resumed = resumeTimer(plus, t.id, 'web', T0 + 200_000);
    expect(Date.parse(resumed[0].endsAt!)).toBe(T0 + 760_000);
    expect(resumed[0].deviceId).toBe('web');
    expect(stopTimer(resumed, t.id)).toEqual([]);
  });

  it('+1 min on a finished timer starts a fresh minute', () => {
    const [t] = startTimer([], input, 'phone', T0);
    const [again] = addTimerMinute([t], t.id, 'web', T0 + 900_000);
    expect(Date.parse(again.endsAt!)).toBe(T0 + 960_000);
    expect(again.seconds).toBe(60);
    expect(again.deviceId).toBe('web');
  });
});

describe('nearest timer and badge', () => {
  const a = startTimer([], input, 'phone', T0);
  const b = startTimer(a, { ...input, index: 1, label: 'Rest', seconds: 120 }, 'phone', T0);
  it('picks a finished timer, then the soonest running one', () => {
    expect(nearestTimer(session(b), T0 + 1000)?.timer.label).toBe('Rest');
    expect(nearestTimer(session(b), T0 + 130_000)?.state).toBe('done');
    expect(cookBadge(session(b), 5, T0 + 60_000)).toEqual({ text: '1:00', tone: 'running' });
  });
  it('shows the step when no timer runs', () => {
    expect(cookBadge(session([], 1), 3, T0)).toEqual({ text: '2/3', tone: 'step' });
  });
  it('finds the nearest across cooks', () => {
    expect(nearestAcrossCooks([session(a), session(b)], T0)?.timer.label).toBe('Rest');
    expect(nearestAcrossCooks([session([])], T0)).toBeNull();
  });
});

describe('ringing', () => {
  it('rings only running timers this device started', () => {
    const mine = startTimer([], input, 'phone', T0);
    const theirs = startTimer(mine, { ...input, index: 1 }, 'web', T0);
    const paused = pauseTimer(theirs, mine[0].id, T0);
    expect(timersToRing([session(theirs)], 'phone')).toHaveLength(1);
    expect(timersToRing([session(paused)], 'phone')).toHaveLength(0);
    expect(timersToRing([{ ...session(theirs), deleted: true }], 'phone')).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('clamps steps and makes initials', () => {
    expect(clampStep(9, 3)).toBe(2);
    expect(clampStep(-1, 3)).toBe(0);
    expect(clampStep(2, 0)).toBe(0);
    expect(cookInitials('Lemon risotto')).toBe('LR');
    expect(cookInitials('Dal')).toBe('DA');
    expect(cookInitials('  ')).toBe('?');
  });
});

describe('head dock', () => {
  it('snaps to the nearest edge and stays clear of the bars', async () => {
    const { snapHeadDock, parseHeadDock, overStopTarget, DEFAULT_HEAD_DOCK } = await import('./cook');
    expect(snapHeadDock(50, 400, 400, 800)).toEqual({ side: 'left', y: 0.5 });
    expect(snapHeadDock(390, 790, 400, 800)).toEqual({ side: 'right', y: 0.78 });
    expect(parseHeadDock('{"side":"left","y":0.2}')).toEqual({ side: 'left', y: 0.2 });
    expect(parseHeadDock('junk')).toEqual(DEFAULT_HEAD_DOCK);
    expect(overStopTarget(200, 700, 400, 800, 36)).toBe(true);
    expect(overStopTarget(200, 400, 400, 800, 36)).toBe(false);
  });
});
