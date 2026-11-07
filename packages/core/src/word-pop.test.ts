import { describe, expect, it } from 'vitest';
import { MOTION_DURATIONS_MS } from './tokens';
import { WORD_POP_MS, newWordPops, wordPopKeys, wordPopWobble, wordPopWobbleFrames } from './word-pop';

describe('newWordPops', () => {
  it('pops a word the first time it lights', () => {
    const title = 'Get thing tomorrow';
    const marks = [{ start: 10, end: 18 }];
    expect(newWordPops([], title, marks)).toEqual(marks);
  });

  it('does not pop a lit word again when text is typed before it', () => {
    const before = wordPopKeys('Get thing tomorrow', [{ start: 10, end: 18 }]);
    const title = 'Get the thing tomorrow';
    expect(newWordPops(before, title, [{ start: 14, end: 22 }])).toEqual([]);
  });

  it('pops only the new word when a second one lights', () => {
    const before = wordPopKeys('Get thing tomorrow', [{ start: 10, end: 18 }]);
    const title = 'Get thing tomorrow 5pm';
    const marks = [
      { start: 10, end: 18 },
      { start: 19, end: 22 },
    ];
    expect(newWordPops(before, title, marks)).toEqual([{ start: 19, end: 22 }]);
  });

  it('ignores case when it compares', () => {
    const before = wordPopKeys('call mum tomorrow', [{ start: 9, end: 17 }]);
    expect(newWordPops(before, 'call mum Tomorrow', [{ start: 9, end: 17 }])).toEqual([]);
  });

  it('pops a word again when its words change', () => {
    const before = wordPopKeys('pay rent in 2 days', [{ start: 9, end: 18 }]);
    expect(newWordPops(before, 'pay rent in 3 days', [{ start: 9, end: 18 }])).toHaveLength(1);
  });
});

describe('wordPopWobble', () => {
  it('starts and ends at rest', () => {
    expect(wordPopWobble(0)).toEqual({ x: 0, rotate: 0, scale: 1 });
    const end = wordPopWobble(1);
    expect(Math.abs(end.x)).toBeLessThan(1e-9);
    expect(Math.abs(end.rotate)).toBeLessThan(1e-9);
    expect(end.scale).toBeCloseTo(1);
  });

  it('stays small and dies away', () => {
    const early = Math.max(...[0.05, 0.1, 0.15].map((t) => Math.abs(wordPopWobble(t).rotate)));
    const late = Math.max(...[0.8, 0.85, 0.9].map((t) => Math.abs(wordPopWobble(t).rotate)));
    expect(early).toBeLessThanOrEqual(2.4);
    expect(late).toBeLessThan(early / 4);
  });

  it('gives the web smooth frames from 0 to 1', () => {
    const frames = wordPopWobbleFrames(24);
    expect(frames).toHaveLength(25);
    expect(frames[0].offset).toBe(0);
    expect(frames[24].offset).toBe(1);
  });

  it('takes the motion tokens slow + fast, then fast + base', () => {
    const { fast, base, slow } = MOTION_DURATIONS_MS;
    expect(WORD_POP_MS).toBe(slow + fast + fast + base);
  });
});
