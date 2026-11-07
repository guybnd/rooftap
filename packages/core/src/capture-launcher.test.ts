import { describe, expect, it } from 'vitest';
import { launcherColumns } from './capture-launcher';

describe('launcherColumns', () => {
  it('fills the rows when it can', () => {
    expect(launcherColumns(8)).toBe(4);
    expect(launcherColumns(9)).toBe(3);
    expect(launcherColumns(6)).toBe(3);
    expect(launcherColumns(4)).toBe(4);
  });
  it('leaves the fewest empty cells otherwise', () => {
    expect(launcherColumns(7)).toBe(4);
    expect(launcherColumns(10)).toBe(4);
    expect(launcherColumns(5)).toBe(3);
  });
});
