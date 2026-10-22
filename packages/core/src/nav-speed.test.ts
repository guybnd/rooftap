import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_NAV_SPEED, NAV_SPEED_MS, getNavSpeed, parseNavSpeed, resetNavSpeedForTests, setNavSpeed, subscribeNavSpeed } from './nav-speed';
import { MOTION_DURATIONS_MS } from './tokens';

afterEach(() => resetNavSpeedForTests());

describe('nav speed', () => {
  it('is Fast by default, on the Hearth slow step, and Smooth is longer', () => {
    expect(DEFAULT_NAV_SPEED).toBe('fast');
    expect(getNavSpeed()).toBe('fast');
    expect(NAV_SPEED_MS.fast).toBe(MOTION_DURATIONS_MS.slow);
    expect(NAV_SPEED_MS.smooth).toBeGreaterThan(NAV_SPEED_MS.fast);
  });

  it('reads anything unknown as the default', () => {
    expect(parseNavSpeed('smooth')).toBe('smooth');
    expect(parseNavSpeed('warp')).toBe('fast');
    expect(parseNavSpeed(null)).toBe('fast');
  });

  it('tells subscribers when the speed changes', () => {
    let calls = 0;
    const off = subscribeNavSpeed(() => calls++);
    setNavSpeed('smooth');
    expect(getNavSpeed()).toBe('smooth');
    expect(calls).toBe(1);
    off();
    setNavSpeed('fast');
    expect(calls).toBe(1);
  });
});
