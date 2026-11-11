// Stand-ins for native modules in screen tests (see screen-setup.tsx).
import * as React from 'react';

/** A component that renders its children and nothing of its own. */
export function Passthrough({ children }: { children?: React.ReactNode }) {
  return <>{children ?? null}</>;
}

/**
 * A value that can be called, chained, awaited and printed: every property is
 * itself, calling it gives itself, awaiting it gives undefined.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const chain: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === 'then') return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(undefined).then(resolve, reject);
    if (key === Symbol.toPrimitive) return () => '';
    if (key === Symbol.iterator) return function* () {};
    if (key === 'toString' || key === 'valueOf') return () => '';
    return chain;
  },
  apply: () => chain,
  construct: () => chain,
});

/**
 * A component that renders its children, whose capitalised properties chain
 * (`Gesture.Pan().onEnd(...)`, `Swipeable.Item`). Other properties stay the
 * function's own, so React still sees a plain function component.
 */
function stubComponent(name: string) {
  const fn = function (props: { children?: React.ReactNode }) {
    return <>{props?.children ?? null}</>;
  };
  Object.defineProperty(fn, 'name', { value: name });
  return new Proxy(fn, {
    construct: () => chain,
    get: (target, key, receiver) =>
      typeof key === 'string' && /^[A-Z]/.test(key) && !(key in target) ? chain : Reflect.get(target, key, receiver),
  });
}

const components = new Map<string, unknown>();

/**
 * A module whose every export is a harmless stand-in: capitalised names are
 * components that render their children, the rest are chainable no-ops.
 */
export function stubModule(
  overrides: Record<string, unknown> = {},
  opts: { capitalised?: 'component' | 'chain' } = {},
): Record<string, unknown> {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === '__esModule') return true;
      if (key === 'then') return undefined;
      if (key === 'default') return stubComponent('Default');
      if (typeof key === 'string' && /^[A-Z]/.test(key) && opts.capitalised !== 'chain') {
        if (!components.has(key)) components.set(key, stubComponent(key));
        return components.get(key);
      }
      return chain;
    },
    has: () => true,
  });
}
