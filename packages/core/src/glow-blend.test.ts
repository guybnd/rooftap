import { describe, expect, it } from 'vitest';
import { glowBlendAt, glowBlendSettle, glowBlendTo, glowLayerAlpha, glowLayerWeight, type GlowBlendState } from './glow-blend';

// What the stacked layers put on screen at full strength: each layer's share
// of the glow colour, and how much ground shows through, compositing bottom
// to top with the solved opacities.
function composite(state: GlowBlendState, p: number, strength: number) {
  const share = new Map<string | null, number>();
  let ground = 1;
  state.layers.forEach((layer, i) => {
    if (layer === null) return;
    const a = strength * glowLayerAlpha(state, i, p, strength);
    for (const [k, v] of share) share.set(k, v * (1 - a));
    share.set(layer, (share.get(layer) ?? 0) + a);
    ground *= 1 - a;
  });
  return { share, ground };
}

describe('glow blend', () => {
  const strength = 0.42;

  it('mixes two glows in proportion at the same strength, never brighter', () => {
    const blend = glowBlendTo(glowBlendAt('home'), 'tasks', 1);
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const { share, ground } = composite(blend, p, strength);
      expect(share.get('tasks')).toBeCloseTo(strength * p, 6);
      expect(share.get('home')).toBeCloseTo(strength * (1 - p), 6);
      expect(ground).toBeCloseTo(1 - strength, 6);
    }
  });

  it('ends with the old layer at 0, so dropping it changes nothing', () => {
    const blend = glowBlendTo(glowBlendAt('home'), 'tasks', 1);
    expect(glowLayerAlpha(blend, 0, 1, strength)).toBe(0);
    expect(glowLayerAlpha(blend, 1, 1, strength)).toBe(1);
    expect(glowBlendSettle(blend)).toEqual(glowBlendAt('tasks'));
  });

  it('picks up mid-blend through quick switches, three layers deep', () => {
    const a = glowBlendTo(glowBlendAt('home'), 'tasks', 1);
    const b = glowBlendTo(a, 'costs', 0.4);
    expect(b.layers).toEqual(['home', 'tasks', 'costs']);
    // The new blend starts exactly where the old one was.
    expect(b.from).toEqual([0.6, 0.4, 0]);
    for (const p of [0, 0.3, 0.6, 1]) {
      const { share, ground } = composite(b, p, strength);
      expect(share.get('home')).toBeCloseTo(strength * 0.6 * (1 - p), 6);
      expect(share.get('tasks')).toBeCloseTo(strength * 0.4 * (1 - p), 6);
      expect(share.get('costs')).toBeCloseTo(strength * p, 6);
      expect(ground).toBeCloseTo(1 - strength, 6);
    }
  });

  it('switching back to a fading glow keeps the weight it still has', () => {
    const a = glowBlendTo(glowBlendAt('home'), 'tasks', 1);
    const b = glowBlendTo(a, 'home', 0.25);
    expect(b.layers).toEqual(['tasks', 'home']);
    expect(b.from).toEqual([0.25, 0.75]);
    expect(b.to).toEqual([0, 1]);
  });

  it('fades out evenly into a section with no glow', () => {
    const blend = glowBlendTo(glowBlendAt('home'), null, 1);
    const { share, ground } = composite(blend, 0.5, strength);
    expect(share.get('home')).toBeCloseTo(strength * 0.5, 6);
    expect(ground).toBeCloseTo(1 - strength * 0.5, 6);
  });

  it('weights always sum to 1', () => {
    const b = glowBlendTo(glowBlendTo(glowBlendAt('a'), 'b', 0.7), 'c', 0.2);
    for (const p of [0, 0.5, 1]) {
      const sum = b.layers.reduce((s, _, i) => s + glowLayerWeight(b.from, b.to, i, p), 0);
      expect(sum).toBeCloseTo(1, 9);
    }
  });
});
