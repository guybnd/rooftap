'use client';

// Home care: the suggestion picker's ticks, shared by web and mobile. Only the
// suggestions marked preticked start ticked, and only on the first run.

import { useMemo, useState } from 'react';
import { openSuggestionsByArea, type CareArea, type CareJob, type CareSuggestion } from './home-care';

export interface CarePickerState {
  picked: Set<string>;
  skipped: Set<CareArea>;
}

/** Ticks for the picker; `result()` is what to save. */
export function useCarePicker(jobs: readonly CareJob[], region: string | null | undefined, firstRun: boolean) {
  const groups = useMemo(() => openSuggestionsByArea(jobs, region), [jobs, region]);
  const initial = (): CarePickerState => ({
    picked: new Set(firstRun ? groups.flatMap((g) => g.suggestions.filter((s) => s.preticked).map((s) => s.id)) : []),
    skipped: new Set(),
  });
  const [state, setState] = useState<CarePickerState>(initial);
  const reset = () => setState(initial());
  const toggle = (id: string) =>
    setState((s) => {
      const picked = new Set(s.picked);
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      return { ...s, picked };
    });
  const toggleSkip = (area: CareArea) =>
    setState((s) => {
      const skipped = new Set(s.skipped);
      const picked = new Set(s.picked);
      if (skipped.has(area)) skipped.delete(area);
      else {
        skipped.add(area);
        for (const sg of groups.find((g) => g.area === area)?.suggestions ?? []) picked.delete(sg.id);
      }
      return { picked, skipped };
    });
  const result = (): { picked: CareSuggestion[]; hidden: CareSuggestion[] } => ({
    picked: groups.flatMap((g) => g.suggestions.filter((s) => state.picked.has(s.id))),
    hidden: groups.filter((g) => state.skipped.has(g.area)).flatMap((g) => g.suggestions),
  });
  return { groups, state, toggle, toggleSkip, reset, result };
}

