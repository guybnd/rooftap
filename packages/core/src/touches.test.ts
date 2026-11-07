import { describe, expect, it } from 'vitest';
import { heroNumber, heroRollDirection, roofDots } from './touches';

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
