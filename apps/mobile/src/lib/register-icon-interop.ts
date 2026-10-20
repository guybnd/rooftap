// HOUP-307: the registration logic behind src/lib/lucide-registry.ts, kept free
// of lucide-react-native / nativewind imports so the unit test can drive it
// with the real lucide barrel loaded natively (importing lucide through
// vitest's pipeline drags in react-native-svg -> react-native, which node
// can't parse — see icon-interop.test.ts).
import type { ComponentType } from 'react';

const FORWARD_REF_TYPE = Symbol.for('react.forward_ref');

export const ICON_CLASSNAME_MAPPING = {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, opacity: true },
  },
} as const;

// color/opacity must be visible as component props for the mapping's
// `nativeStyleToProp: { color: true, opacity: true }` to typecheck — lucide
// icons accept both (SvgProps).
type IconComponent = ComponentType<{ style?: unknown; color?: unknown; opacity?: unknown }>;

type InteropRegistrar = (
  component: IconComponent,
  mapping: typeof ICON_CLASSNAME_MAPPING,
) => unknown;

// Returns a registrar that wires each lucide icon component it's handed into
// NativeWind's cssInterop exactly once, across calls (babel-plugin-lucide-
// imports.js calls it from every importing module, so the same icon arrives
// many times). lucide exports each icon under several alias names pointing
// at the same forwardRef component; non-component values (the `icons`
// namespace object, the `createLucideIcon` factory) are skipped by the
// forwardRef shape check.
export function createIconRegistrar(cssInterop: InteropRegistrar): (icons: readonly unknown[]) => number {
  const registered = new Set<unknown>();
  return (icons) => {
    let added = 0;
    for (const icon of icons) {
      const isIconComponent =
        typeof icon === 'object' &&
        icon !== null &&
        (icon as { $$typeof?: symbol }).$$typeof === FORWARD_REF_TYPE;
      if (!isIconComponent || registered.has(icon)) continue;
      registered.add(icon);
      cssInterop(icon as IconComponent, ICON_CLASSNAME_MAPPING);
      added++;
    }
    return added;
  };
}

// Registers every icon component in a lucide-react-native module namespace.
// Only the unit test drives the whole barrel now; it guards that lucide's
// icons still have the shape the registrar matches.
export function registerIconInterop(
  lucideNamespace: Record<string, unknown>,
  cssInterop: InteropRegistrar,
): number {
  return createIconRegistrar(cssInterop)(Object.values(lucideNamespace));
}
