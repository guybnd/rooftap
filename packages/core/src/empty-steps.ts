// The "Try" group on an empty module screen (Hearth §13.9 "Empty screens"):
// the screen's own add (the screen supplies it), then the module's declared
// first steps (manifest `firstSteps`), then one of its Ask Rooftap starters
// while the Assistant is on. Kept out of any module folder because it reads
// every manifest, like assistant-reach.ts.
import { ALL_MANIFESTS } from './module-manifests';
import type { ModuleId } from './modules';

export interface EmptyFirstStep {
  label: string;
  meta?: string;
  href: string;
  /** The module whose tile leads the row. */
  module: string;
}

export interface EmptyFirstSteps {
  steps: EmptyFirstStep[];
  /** An ask for Rooftap, or null when the Assistant is off or the module offers none. */
  ask: string | null;
}

/** Days since the epoch in local time, so the ask changes once a day. */
function localDay(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
}

/** What an empty screen of `moduleId` offers besides its own add. */
export function emptyFirstSteps(moduleId: string, isEnabled: (id: ModuleId) => boolean, now: Date = new Date()): EmptyFirstSteps {
  const manifest = ALL_MANIFESTS.find((m) => m.id === moduleId);
  if (!manifest) return { steps: [], ask: null };
  const steps = (manifest.firstSteps ?? [])
    .map((s) => ({ label: s.label, meta: s.meta, href: s.href, module: s.module ?? moduleId }))
    .filter((s) => isEnabled(s.module as ModuleId));
  const asks = isEnabled('assistant' as ModuleId)
    ? (manifest.askStarters ?? [])
        .map((d) => (typeof d === 'string' ? { text: d, with: [] as readonly string[] } : d))
        .filter((d) => d.with.every((id) => isEnabled(id as ModuleId)))
    : [];
  return { steps, ask: asks.length > 0 ? asks[localDay(now) % asks.length].text : null };
}
