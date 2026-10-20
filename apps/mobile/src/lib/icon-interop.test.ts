// HOUP-307: guards the app-wide icon cssInterop registration. If lucide ever
// changes its component shape (e.g. drops forwardRef) the registration loop
// would silently match nothing and every icon would regress to black — the
// count + spot-check assertions here turn that into a test failure.
//
// The real lucide barrel can't be imported through vitest's pipeline: it
// drags in react-native-svg -> react-native, whose untranspiled Flow source
// node can't parse, and vitest 4 no longer honors `server.deps.inline`, so
// vi.mock can't intercept that chain. Instead, load lucide's CJS build
// natively and pre-seed node's require cache with a react-native-svg stub —
// lucide only touches NativeSvg.* at render time, so an empty module is fine.
import { createRequire } from 'node:module';
import { forwardRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ICON_CLASSNAME_MAPPING, createIconRegistrar, registerIconInterop } from './register-icon-interop';

function loadRealLucide(): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  // Resolve react-native-svg exactly as lucide will (from lucide's own dist
  // location) so the cache stub keys on the same file.
  const lucidePath = require.resolve('lucide-react-native');
  const lucideRequire = createRequire(lucidePath);
  const svgPath = lucideRequire.resolve('react-native-svg');
  if (!lucideRequire.cache[svgPath]) {
    const stub = new (require('node:module').Module)(svgPath);
    stub.filename = svgPath;
    stub.loaded = true;
    stub.exports = {};
    lucideRequire.cache[svgPath] = stub;
  }
  return require(lucidePath) as Record<string, unknown>;
}

describe('registerIconInterop', () => {
  // Cold-cache native require of lucide's CJS build (~1600 icons) has been
  // observed at >20s on this machine; warm runs take <1s.
  it('registers every real lucide icon component with the className->color mapping', { timeout: 60_000 }, () => {
    const lucide = loadRealLucide();
    const cssInterop = vi.fn();

    const registeredCount = registerIconInterop(lucide, cssInterop);

    // ~1600 icons in lucide 0.545 — a collapse of the registration loop
    // (shape mismatch, bad filter) shows up as a huge drop here.
    expect(registeredCount).toBeGreaterThan(1000);
    expect(cssInterop).toHaveBeenCalledTimes(registeredCount);

    const registeredComponents = new Set(cssInterop.mock.calls.map((call) => call[0]));
    // Spot-check icons the app renders with className tones today, plus the
    // generic Icon component.
    for (const name of ['Trash2', 'ChevronDown', 'Bell', 'LayoutGrid', 'Icon']) {
      expect(registeredComponents.has(lucide[name]), `${name} not registered`).toBe(true);
    }
    // Alias exports point at the same component — each registered once.
    expect(registeredComponents.size).toBe(cssInterop.mock.calls.length);
    // Non-component exports must not be registered.
    expect(registeredComponents.has(lucide.createLucideIcon)).toBe(false);
    expect(registeredComponents.has(lucide.icons)).toBe(false);

    for (const call of cssInterop.mock.calls) {
      expect(call[1]).toBe(ICON_CLASSNAME_MAPPING);
    }
  });

  it('skips non-component values and dedupes aliases', () => {
    const iconA = forwardRef(() => null);
    const iconB = forwardRef(() => null);
    const cssInterop = vi.fn();

    const count = registerIconInterop(
      {
        IconA: iconA,
        IconAAlias: iconA,
        IconB: iconB,
        icons: { IconA: iconA },
        createLucideIcon: () => iconA,
        someString: 'nope',
        someNull: null,
      },
      cssInterop,
    );

    expect(count).toBe(2);
    expect(cssInterop).toHaveBeenCalledTimes(2);
    expect(cssInterop).toHaveBeenCalledWith(iconA, ICON_CLASSNAME_MAPPING);
    expect(cssInterop).toHaveBeenCalledWith(iconB, ICON_CLASSNAME_MAPPING);
  });

  it('registers each icon once across calls (one call per importing module)', () => {
    const iconA = forwardRef(() => null);
    const iconB = forwardRef(() => null);
    const cssInterop = vi.fn();
    const register = createIconRegistrar(cssInterop);

    expect(register([iconA])).toBe(1);
    expect(register([iconA, iconB, 'not-an-icon'])).toBe(1);
    expect(cssInterop).toHaveBeenCalledTimes(2);
  });
});
