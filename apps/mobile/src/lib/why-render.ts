// HOUP-240: attributes a re-render to the specific value(s) that changed
// reference since the previous render of the same named component, instead
// of guessing. Gated behind the same EXPO_PUBLIC_PERF_TRACE flag as
// perf-log.ts — inert (and allocation-free beyond the flag check) in a
// normal release build.
import { perfMark } from './perf-log';

const ENABLED = process.env.EXPO_PUBLIC_PERF_TRACE === '1';

const prevValuesByName = new Map<string, Record<string, unknown>>();

export function whyRender(name: string, values: Record<string, unknown>) {
  if (!ENABLED) return;
  const prev = prevValuesByName.get(name);
  if (prev) {
    const changed: string[] = [];
    for (const key of Object.keys(values)) {
      if (!Object.is(prev[key], values[key])) changed.push(key);
    }
    perfMark(`${name}:why`, changed.length ? changed.join(',') : '(no tracked value changed)');
  }
  prevValuesByName.set(name, values);
}
