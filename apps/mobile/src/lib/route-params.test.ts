// HOUP-110 review follow-up: the ?add=1 deep-link's only non-trivial logic
// is this param parse (the tasks/groceries screen effects that consume it
// are one-line React state setters, already exercised by the plan's manual
// device test) — extracted out of the two duplicated inline copies so it
// has one tested definition.
import { describe, expect, it } from 'vitest';
import { isFlagParamSet } from './route-params';

describe('isFlagParamSet', () => {
  it('is false when the param is absent', () => {
    expect(isFlagParamSet(undefined)).toBe(false);
  });

  it('is true for the exact string "1"', () => {
    expect(isFlagParamSet('1')).toBe(true);
  });

  it('is false for any other string value', () => {
    expect(isFlagParamSet('0')).toBe(false);
    expect(isFlagParamSet('true')).toBe(false);
  });

  it('unwraps a repeated-key array to its first value', () => {
    expect(isFlagParamSet(['1', '0'])).toBe(true);
    expect(isFlagParamSet(['0', '1'])).toBe(false);
  });

  it('is false for an empty array', () => {
    expect(isFlagParamSet([])).toBe(false);
  });
});
