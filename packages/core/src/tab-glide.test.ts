import { describe, expect, it } from 'vitest';
import {
  GLOW_DRIFT_RANGE,
  GLOW_DRIFT_REST,
  glowDriftX,
  TAB_GLIDE_MAX_HOP,
  TAB_GLIDE_SIZE,
  TAB_GLIDE_STRETCH,
  tabBlobPath,
  tabGlideEdges,
  tabPebbleMetrics,
  tabTravelDirection,
} from './tab-glide';
import { motionEaseOut, navEase } from './tokens';

const W = TAB_GLIDE_SIZE.width;
const H = TAB_GLIDE_SIZE.height;

function bounds(d: string) {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('tabTravelDirection', () => {
  const order = ['home', 'calendar', 'setup', 'tasks'];

  it('is forward toward the end of the bar and back toward the start', () => {
    expect(tabTravelDirection(order, 'home', 'setup')).toBe(1);
    expect(tabTravelDirection(order, 'tasks', 'calendar')).toBe(-1);
  });

  it('has no direction for the same tab or a section outside the bar', () => {
    expect(tabTravelDirection(order, 'home', 'home')).toBe(0);
    expect(tabTravelDirection(order, 'home', 'recipes')).toBe(0);
    expect(tabTravelDirection(order, 'settings', 'home')).toBe(0);
  });
});

describe('tabGlideEdges', () => {
  const steps = Array.from({ length: 21 }, (_, i) => i / 20);

  it('sits at rest on the old tab at the start and on the new one at the end', () => {
    expect(tabGlideEdges(100, 180, 0, W)).toEqual({ left: 100 - W / 2, right: 100 + W / 2 });
    expect(tabGlideEdges(100, 180, 1, W)).toEqual({ left: 180 - W / 2, right: 180 + W / 2 });
  });

  it('keeps its centre exactly as far along the hop as the progress', () => {
    for (const p of steps) {
      const { left, right } = tabGlideEdges(100, 180, p, W);
      expect((left + right) / 2).toBeCloseTo(100 + 80 * p, 6);
    }
  });

  it('is widest halfway, by its share of the hop, capped for long hops', () => {
    const width = (from: number, to: number, p: number) => {
      const { left, right } = tabGlideEdges(from, to, p, W);
      return right - left;
    };
    expect(width(100, 180, 0.5)).toBeCloseTo(W + TAB_GLIDE_STRETCH * 80, 6);
    expect(width(100, 180, 0.25)).toBeLessThan(width(100, 180, 0.5));
    expect(width(100, 180, 0.75)).toBeLessThan(width(100, 180, 0.5));
    expect(width(0, 400, 0.5)).toBeCloseTo(W + TAB_GLIDE_STRETCH * W * TAB_GLIDE_MAX_HOP, 6);
  });

  it('only ever moves each edge toward the new tab, either way along the bar', () => {
    for (const [from, to] of [
      [100, 180],
      [100, 400],
      [300, 40],
    ]) {
      const sign = Math.sign(to - from);
      let prev = tabGlideEdges(from, to, 0, W);
      for (const p of steps.slice(1)) {
        const next = tabGlideEdges(from, to, p, W);
        expect((next.left - prev.left) * sign).toBeGreaterThanOrEqual(-1e-9);
        expect((next.right - prev.right) * sign).toBeGreaterThanOrEqual(-1e-9);
        prev = next;
      }
    }
  });
});

describe('motionEaseOut', () => {
  // Brute-force cubic-bezier(0.16, 1, 0.3, 1): sample the curve finely and
  // read y at the sample whose x is closest to t.
  function reference(t: number) {
    let best = { dx: Infinity, y: 0 };
    for (let i = 0; i <= 200_000; i++) {
      const s = i / 200_000;
      const x = 3 * (1 - s) ** 2 * s * 0.16 + 3 * (1 - s) * s ** 2 * 0.3 + s ** 3;
      const y = 3 * (1 - s) ** 2 * s + 3 * (1 - s) * s ** 2 + s ** 3;
      const dx = Math.abs(x - t);
      if (dx < best.dx) best = { dx, y };
    }
    return best.y;
  }

  it('matches the swift-out curve the page shift runs on', () => {
    for (const t of [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 0.98]) {
      expect(motionEaseOut(t)).toBeCloseTo(reference(t), 4);
    }
  });

  it('starts at 0, ends at 1 and never runs backwards', () => {
    expect(motionEaseOut(0)).toBe(0);
    expect(motionEaseOut(1)).toBe(1);
    expect(motionEaseOut(-0.5)).toBe(0);
    expect(motionEaseOut(1.5)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const y = motionEaseOut(i / 100);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});

describe('navEase', () => {
  it('is the ease-out cubic the tab switch moves on', () => {
    // cubic-bezier(0.33, 1, 0.68, 1) is 1 - (1 - t)^3 to within a hair.
    for (const t of [0.05, 0.1, 0.25, 0.5, 0.75, 0.95]) {
      expect(navEase(t)).toBeCloseTo(1 - (1 - t) ** 3, 2);
    }
  });

  it('moves a 60%-wide shift by at most ~10% of the width a frame at 120Hz', () => {
    const frames = 300 / (1000 / 120);
    let worst = 0;
    for (let i = 0; i < frames; i++) worst = Math.max(worst, navEase((i + 1) / frames) - navEase(i / frames));
    expect(worst * 0.6).toBeLessThan(0.06);
  });
});

describe('tabBlobPath', () => {
  it('draws a closed shape spanning its edges at its rest height', () => {
    const d = tabBlobPath(10, 10 + W, 26, W, H, 0);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    const b = bounds(d);
    expect(b.minX).toBeCloseTo(10, 1);
    expect(b.maxX).toBeCloseTo(10 + W, 1);
    expect(b.maxY - b.minY).toBeCloseTo(H, 0);
  });

  it('thins as it stretches and bulges when squeezed', () => {
    const rest = bounds(tabBlobPath(0, W, 26, W, H, 0));
    const stretched = bounds(tabBlobPath(0, W * 2, 26, W, H, 1));
    const squeezed = bounds(tabBlobPath(0, W * 0.8, 26, W, H, 1));
    expect(stretched.maxY - stretched.minY).toBeLessThan(rest.maxY - rest.minY);
    expect(squeezed.maxY - squeezed.minY).toBeGreaterThan(rest.maxY - rest.minY);
  });

  it('leans its crest toward the travel direction', () => {
    const crestX = (d: string) => Number(d.split('C')[1].trim().split(' ')[4]);
    const forward = crestX(tabBlobPath(0, W * 1.6, 26, W, H, 1));
    const back = crestX(tabBlobPath(0, W * 1.6, 26, W, H, -1));
    expect(forward).toBeGreaterThan(W * 0.8);
    expect(back).toBeLessThan(W * 0.8);
  });
});

describe('tabPebbleMetrics', () => {
  it('rests at its own size with no lean', () => {
    expect(tabPebbleMetrics(10, 10 + W, W, H, 1)).toEqual({ cx: 10 + W / 2, width: W, height: H, lean: 0 });
  });

  it('stretches thinner and leans the way it travels, squeezes taller', () => {
    const forward = tabPebbleMetrics(0, W * 1.5, W, H, 1);
    const back = tabPebbleMetrics(0, W * 1.5, W, H, -1);
    expect(forward.height).toBeLessThan(H);
    expect(forward.lean).toBeCloseTo(0.5);
    expect(back.lean).toBeCloseTo(-0.5);
    expect(tabPebbleMetrics(0, W * 0.8, W, H, 1).height).toBeGreaterThan(H);
  });
});

describe('glowDriftX', () => {
  const order = ['home', 'household', 'groceries', 'costs', 'calendar'];
  it('runs from the first section on the left to the last on the right', () => {
    expect(glowDriftX(order, 'home')).toBeCloseTo(GLOW_DRIFT_RANGE[0]);
    expect(glowDriftX(order, 'calendar')).toBeCloseTo(GLOW_DRIFT_RANGE[1]);
    expect(glowDriftX(order, 'groceries')).toBeCloseTo((GLOW_DRIFT_RANGE[0] + GLOW_DRIFT_RANGE[1]) / 2);
  });
  it('rests in the corner for a section outside the order, or a single section', () => {
    expect(glowDriftX(order, 'settings')).toBe(GLOW_DRIFT_REST);
    expect(glowDriftX(['home'], 'home')).toBe(GLOW_DRIFT_REST);
  });
});
