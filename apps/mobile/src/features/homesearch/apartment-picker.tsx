// HOUP-78: native port of apps/web/src/components/apartment-picker.tsx. Web
// opens a DOM popover with keyboard nav (↑/↓/Enter/Esc) and a `document`
// "mousedown" outside-click listener to dismiss; native has no `document` to
// listen on, so — per the established pattern already used by
// `packages/ui/src/components/searchable-picker.tsx` and
// `assignee-picker.tsx` — the picker is built on top of `SearchablePicker`,
// whose `BottomSheet` base gives "dismiss without picking" for free via
// backdrop press + Android hardware-back. `fuzzyMatchApartment` has no
// browser globals in the original, so it is ported unchanged. `SearchablePicker`
// has no built-in "suggested/featured" option concept (checked its props in
// searchable-picker.tsx), so the suggested apartment is sorted to the front
// of the options array instead, with "Suggested" folded into its secondary
// label. Web's inline clear (X) button on the trigger has no `SearchablePicker`
// equivalent (its trigger only opens the sheet); dropped rather than
// re-implemented as a one-off — callers needing "no apartment" can still pick
// it via the sheet if an explicit "None" option is added later.
import { useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { SearchablePicker, type PickerOption } from '@homeup/ui';
import { apartments$, useReconnectSync, type Apartment } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

export interface ApartmentPickerProps {
  value: string | null;
  onChange: (apartmentId: string | null) => void;
  suggestedId?: string | null;
}

export function ApartmentPicker({ value, onChange, suggestedId }: ApartmentPickerProps) {
  const { group } = useDataCache();
  const apts$ = apartments$(group?.id);
  useReconnectSync(apts$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );

  const options = useMemo((): PickerOption[] => {
    const toOption = (a: Apartment, suggested: boolean): PickerOption => ({
      value: a.id,
      primary: a.address,
      secondary: suggested
        ? `${a.suburb ? `${a.suburb} · ` : ''}Suggested`
        : a.suburb ?? undefined,
      searchText: a.suburb ?? undefined,
    });

    if (suggestedId && !value) {
      const suggested = apartments.find((a) => a.id === suggestedId);
      if (suggested) {
        const rest = apartments.filter((a) => a.id !== suggestedId);
        return [toOption(suggested, true), ...rest.map((a) => toOption(a, false))];
      }
    }
    return apartments.map((a) => toOption(a, false));
  }, [apartments, suggestedId, value]);

  return (
    <SearchablePicker
      options={options}
      value={value}
      onChange={(id) => onChange(id || null)}
      placeholder="Select apartment…"
      searchPlaceholder="Search by address or suburb…"
      emptyText="No apartments found"
      ariaLabel="Select apartment"
    />
  );
}

export function fuzzyMatchApartment(
  location: string,
  apartments: { id: string; address: string; suburb: string | null }[]
): string | null {
  if (!location.trim()) return null;
  const loc = location.toLowerCase();

  let bestId: string | null = null;
  let bestScore = 0;

  for (const apt of apartments) {
    const addr = apt.address.toLowerCase();
    const suburb = (apt.suburb || '').toLowerCase();
    const full = `${addr} ${suburb}`;

    if (loc.includes(addr) || addr.includes(loc)) {
      return apt.id;
    }

    const locWords = loc.split(/[\s,]+/).filter((w) => w.length > 2);
    const matchCount = locWords.filter((w) => full.includes(w)).length;
    const score = locWords.length > 0 ? matchCount / locWords.length : 0;

    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestId = apt.id;
    }
  }

  return bestId;
}
