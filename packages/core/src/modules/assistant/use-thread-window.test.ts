import { describe, expect, it } from 'vitest';
import { threadWindowStart } from './use-thread-window';

describe('threadWindowStart', () => {
  it('shows the latest messages', () => {
    expect(threadWindowStart(40, 16, null)).toBe(24);
    expect(threadWindowStart(10, 16, null)).toBe(0);
  });
  it('never hides the brief or what came after it', () => {
    expect(threadWindowStart(40, 16, 40)).toBe(24);
    expect(threadWindowStart(40, 16, 20)).toBe(20);
  });
});
