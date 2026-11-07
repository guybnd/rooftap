import { describe, expect, it } from 'vitest';
import { CHEER_BURST_MS, cheerSparks, heroNumber, heroRollDirection, isFreshReply, justCleared, roofDots } from './touches';

describe('heroNumber', () => {
  it('reads counts and amounts', () => {
    expect(heroNumber(3)).toBe(3);
    expect(heroNumber('12')).toBe(12);
    expect(heroNumber('$1,115')).toBe(1115);
    expect(heroNumber('-$40.50')).toBe(-40.5);
    expect(heroNumber('85%')).toBe(85);
  });

  it('leaves words alone', () => {
    expect(heroNumber('All clear')).toBeNull();
    expect(heroNumber('3 days')).toBeNull();
    expect(heroNumber(null)).toBeNull();
  });
});

describe('heroRollDirection', () => {
  it('rolls down when the count drops and up when it grows', () => {
    expect(heroRollDirection(3, 2)).toBe(-1);
    expect(heroRollDirection('$900', '$1,115')).toBe(1);
  });

  it('does not roll without a change between two numbers', () => {
    expect(heroRollDirection(2, 2)).toBe(0);
    expect(heroRollDirection(1, 'All clear')).toBe(0);
  });
});

describe('roofDots', () => {
  it('draws six dots in a symmetric roof above the thing', () => {
    const dots = roofDots(80, 80);
    expect(dots).toHaveLength(6);
    expect(dots.map((d) => d.x)).toEqual([-40, -24, -8, 8, 24, 40]);
    for (const d of dots) expect(d.y).toBeLessThan(-40);
    expect(dots[2].y).toBeLessThan(dots[1].y);
    expect(dots[0].y).toBe(dots[5].y);
  });
});

describe('justCleared', () => {
  it('fires only when a count drops to nothing', () => {
    expect(justCleared(1, 0)).toBe(true);
    expect(justCleared(3, 0)).toBe(true);
    expect(justCleared(0, 0)).toBe(false);
    expect(justCleared(undefined, 0)).toBe(false);
    expect(justCleared(2, 1)).toBe(false);
  });
});

describe('isFreshReply', () => {
  const now = Date.parse('2026-11-07T10:00:30Z');
  it('is fresh for a reply written in the last 20 seconds', () => {
    expect(isFreshReply('2026-11-07T10:00:20Z', now)).toBe(true);
    expect(isFreshReply('2026-11-07T09:59:00Z', now)).toBe(false);
    expect(isFreshReply(null, now)).toBe(false);
  });
});

describe('cheerSparks', () => {
  it('rings the thing with coral and roof colours in turn', () => {
    const sparks = cheerSparks(120, 60);
    expect(sparks).toHaveLength(10);
    expect(sparks.filter((s) => s.coral)).toHaveLength(5);
    for (const s of sparks) {
      const r = Math.hypot(s.x / (60 + 26), s.y / (30 + 26));
      expect(r).toBeCloseTo(1, 1);
    }
  });

  it('takes slow + base', () => {
    expect(CHEER_BURST_MS).toBe(500);
  });
});
