import { describe, expect, it } from 'vitest';
import { ASSISTANT_EDGE_TURN_MS, ROOFTAP_SPECTRUM, spectrumRing } from './brand-mark';

describe('spectrumRing', () => {
  it('starts on coral and lands on each spectrum colour at its step', () => {
    const ring = spectrumRing(36);
    expect(ring).toHaveLength(36);
    ROOFTAP_SPECTRUM.forEach((c, i) => expect(ring[i * 6].toUpperCase()).toBe(c));
  });
  it('blends between neighbours', () => {
    expect(spectrumRing(12)[1]).toBe('#ffa24d');
  });
});

describe('ASSISTANT_EDGE_TURN_MS', () => {
  it('turns faster the busier Rooftap is', () => {
    expect(ASSISTANT_EDGE_TURN_MS.rest).toBeGreaterThan(ASSISTANT_EDGE_TURN_MS.listening);
    expect(ASSISTANT_EDGE_TURN_MS.listening).toBeGreaterThan(ASSISTANT_EDGE_TURN_MS.thinking);
  });
});
