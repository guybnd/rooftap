'use client';

// Home Search's slots (.docs/modules.md, section 17). Search: viewings
// (grouped as Calendar), the viewing checklist, and every listing.

import { useMemo } from 'react';
import { apartmentChecklistItems$, apartments$, appointments$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import type { Appointment, ChecklistItem } from '../../types';

type ListingRow = { id: string; address: string; suburb?: string | null; main_location?: string | null; notes?: string | null; deleted?: boolean };

export function homeSearchHits(input: {
  appointments: readonly Appointment[];
  apartments: readonly ListingRow[];
  checklistItems: readonly ChecklistItem[];
}): GlobalHit[] {
  const apartments = input.apartments.filter((a) => !a.deleted);
  const hits: GlobalHit[] = [];
  for (const a of input.appointments) {
    if (a.deleted) continue;
    const apt = apartments.find((ap) => ap.id === a.apartment_id);
    hits.push({
      section: 'calendar',
      sectionId: 'calendar',
      sectionLabel: 'Calendar',
      id: a.id,
      title: apt?.address || a.notes || 'Viewing',
      subtitle: a.status,
      keywords: [a.notes].filter(Boolean).join(' '),
      href: '/calendar',
    });
  }
  // The viewing checklist and the Checklists section are two different
  // things; results group under their labels, so they must differ.
  for (const c of input.checklistItems) {
    if (c.deleted) continue;
    hits.push({
      section: 'checklist',
      sectionId: 'search',
      sectionLabel: 'Viewing checklist',
      id: c.id,
      title: c.label,
      subtitle: c.category,
      keywords: c.category,
      href: '/checklist',
    });
  }
  for (const ap of apartments) {
    hits.push({
      section: 'search',
      sectionId: 'search',
      sectionLabel: 'Home Search',
      id: ap.id,
      title: ap.address,
      subtitle: ap.suburb ?? ap.main_location ?? undefined,
      keywords: [ap.suburb, ap.main_location, ap.notes].filter(Boolean).join(' '),
      href: `/apartment/${ap.id}`,
    });
  }
  return hits;
}

export const homeSearchSearchSource: SearchSource = {
  moduleId: 'search',
  useHits({ groupId, active }) {
    const appointments = useSlotRows(appointments$, groupId, active);
    const apartments = useSlotRows(apartments$, groupId, active);
    const checklistItems = useSlotRows(apartmentChecklistItems$, groupId, active);
    return useMemo(
      () => ({ hits: homeSearchHits({ appointments, apartments, checklistItems }) }),
      [appointments, apartments, checklistItems],
    );
  },
};
