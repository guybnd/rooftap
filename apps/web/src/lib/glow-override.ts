'use client';

// Hearth v2: lets a page borrow another section's glow for a while (Home's
// shortcut lenses take the hue of the section they filter to). The app
// shell's SectionGlow reads it; null hands the glow back to the route.
import { useSyncExternalStore } from 'react';

let override: string | null = null;
const listeners = new Set<() => void>();

export function setGlowOverride(sectionId: string | null): void {
  if (override === sectionId) return;
  override = sectionId;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGlowOverride(): string | null {
  return useSyncExternalStore(subscribe, () => override, () => null);
}
