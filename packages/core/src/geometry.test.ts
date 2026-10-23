import { describe, expect, it } from 'vitest';
import { haversineMeters, smoothPath } from './geometry';

describe('smoothPath', () => {
  it('is empty without points and a bare move for one', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([[1, 2]])).toBe('M1,2');
  });

  it('draws one cubic per gap, ending on each point', () => {
    const d = smoothPath([[0, 0], [6, 6], [12, 0]]);
    expect(d.startsWith('M0,0 C')).toBe(true);
    expect(d.match(/ C/g)).toHaveLength(2);
    expect(d.endsWith(' 12,0')).toBe(true);
  });
});

describe('haversineMeters', () => {
  it('is zero for the same place and about 111 km per degree of latitude', () => {
    expect(haversineMeters(-37.8, 144.9, -37.8, 144.9)).toBe(0);
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -1);
  });
});
