// FLUX-152 / HOUP-147: global fuzzy search index for the /home hub, shared
// between web (the /home hub + capture sheet) and apps/mobile (the capture
// sheet's search step). Moved from apps/web/src/hooks/use-global-search-index.ts
// to packages/core — its only web-specific binding was constructing a
// Supabase client, replaced below with an injected `supabase` arg so callers
// on either platform pass their own client. Web now re-exports this via a
// thin shim at its old import path.
//
// Builds a flat list of GlobalHit (one per searchable item across all sections)
// from all available section data. The caller feeds it through useFuzzySearch
// (fuse.js) and groups the results by section for display.
//
// Documents are fetched internally via a useEffect (one async call, mirroring
// DocumentsTile). All other sections are passed in from the caller — Legend
// stores are singletons so there is no extra network cost.

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listUnifiedDocuments, type UnifiedDocument } from '../documents';
import { recipeCuisines } from '../recipes';
import { useModules } from '../modules-store';
import type { HouseholdTask, GroceryItem, CostItem, SetupItem, Appointment, ChecklistItem, Recipe, Checklist, Document } from '../types';

export type SectionKey =
  | 'tasks'
  | 'groceries'
  | 'costs'
  | 'setup'
  | 'calendar'
  | 'checklist'
  | 'search'
  | 'documents'
  | 'recipes'
  | 'checklists';

export const SECTION_LABELS: Record<SectionKey, string> = {
  tasks: 'Tasks',
  groceries: 'Groceries',
  costs: 'Costs',
  setup: 'Setup',
  calendar: 'Calendar',
  // The search domain's viewing checklist and the Checklists section are two
  // different things; results group under these labels, so they must differ.
  checklist: 'Viewing checklist',
  search: 'Home Search',
  documents: 'Documents',
  recipes: 'Recipes',
  checklists: 'Checklists',
};

/**
 * The sections.ts id each SectionKey belongs to: the search domain's keys are
 * finer-grained than the section registry (tasks live under "household";
 * viewing-checklist items and apartments surface under Home search, while
 * calendar keeps its own section). Drives a hit's leading tile and identity
 * hue on both platforms (moved from apps/mobile's section-key-registry.ts so
 * web's capture sheet reads the same table).
 */
export const GLOBAL_HIT_SECTION_ID: Record<SectionKey, string> = {
  tasks: 'household',
  groceries: 'groceries',
  costs: 'costs',
  setup: 'setup',
  calendar: 'calendar',
  checklist: 'search',
  search: 'search',
  documents: 'documents',
  recipes: 'recipes',
  checklists: 'checklists',
};

// Section key → base path for navigation-only sections.
const SECTION_PATHS: Partial<Record<SectionKey, string>> = {
  setup: '/setup',
  calendar: '/calendar',
  checklist: '/checklist',
  documents: '/documents',
  recipes: '/recipes',
  checklists: '/checklists',
};

export interface GlobalHit {
  section: SectionKey;
  sectionLabel: string;
  id: string;
  title: string;
  subtitle?: string;
  /** Concatenated searchable fields beyond title/subtitle. */
  keywords: string;
  /** Navigation href for non-modal sections (setup, calendar, checklist, documents, apartments). */
  href?: string;
}

/** The action a hit resolves to when tapped/clicked — the single source of the nav-vs-modal decision. */
export type GlobalHitAction =
  | { kind: 'nav'; href: string }
  | { kind: 'modal'; section: SectionKey; id: string };

const MODAL_SECTIONS = new Set<SectionKey>(['tasks', 'groceries', 'costs']);

/**
 * Resolves what should happen when a GlobalHit is activated. Tasks/groceries/
 * costs open their native edit modal; every other section navigates. Per-item
 * `hit.href` always wins over the section-level `SECTION_PATHS` fallback so
 * per-item routes (apartments, recipes, checklists) survive.
 */
export function resolveGlobalHitAction(hit: GlobalHit): GlobalHitAction {
  if (MODAL_SECTIONS.has(hit.section)) {
    return { kind: 'modal', section: hit.section, id: hit.id };
  }
  return { kind: 'nav', href: hit.href ?? SECTION_PATHS[hit.section] ?? '' };
}

interface UseGlobalSearchIndexArgs {
  supabase: SupabaseClient;
  groupId: string;
  hiddenSections: string[];
  tasks: HouseholdTask[];
  groceries: GroceryItem[];
  costItems: CostItem[];
  setupItems: SetupItem[];
  appointments: Appointment[];
  apartments: { id: string; address: string; suburb?: string | null; main_location?: string | null; notes?: string | null }[];
  checklistItems: ChecklistItem[];
  recipes: Recipe[];
  checklists: Checklist[];
  /** Optional pre-fetched document rows (e.g. a Legend store) in place of a fresh fetch. */
  documentStoreRows?: Document[];
}

interface BuildGlobalHitsArgs {
  hiddenSections: string[];
  tasks: HouseholdTask[];
  groceries: GroceryItem[];
  costItems: CostItem[];
  setupItems: SetupItem[];
  appointments: Appointment[];
  apartments: { id: string; address: string; suburb?: string | null; main_location?: string | null; notes?: string | null }[];
  checklistItems: ChecklistItem[];
  documents: UnifiedDocument[];
  recipes: Recipe[];
  checklists: Checklist[];
}

/**
 * Pure hit-building logic behind `useGlobalSearchIndex`'s memo — pulled out
 * so it's unit-testable without rendering the hook (this package's vitest
 * environment is `node`, no jsdom/testing-library; see use-fuzzy-search.test.ts).
 */
export function buildGlobalHits({
  hiddenSections,
  tasks,
  groceries,
  costItems,
  setupItems,
  appointments,
  apartments,
  checklistItems,
  documents,
  recipes,
  checklists,
}: BuildGlobalHitsArgs): GlobalHit[] {
  const hidden = new Set(hiddenSections);
  const hits: GlobalHit[] = [];

  // ── Tasks ──────────────────────────────────────────────────────────────────
  if (!hidden.has('household')) {
    for (const t of tasks) {
      if (t.deleted) continue;
      hits.push({
        section: 'tasks',
        sectionLabel: SECTION_LABELS.tasks,
        id: t.id,
        title: t.title,
        subtitle: t.due_date ?? undefined,
        keywords: [t.notes].filter(Boolean).join(' '),
      });
    }
  }

  // ── Groceries ─────────────────────────────────────────────────────────────
  if (!hidden.has('groceries')) {
    for (const g of groceries) {
      if (g.deleted) continue;
      hits.push({
        section: 'groceries',
        sectionLabel: SECTION_LABELS.groceries,
        id: g.id,
        title: g.name,
        subtitle: g.aisle,
        keywords: [g.notes].filter(Boolean).join(' '),
      });
    }
  }

  // ── Costs ─────────────────────────────────────────────────────────────────
  if (!hidden.has('costs')) {
    for (const c of costItems) {
      if (c.deleted) continue;
      hits.push({
        section: 'costs',
        sectionLabel: SECTION_LABELS.costs,
        id: c.id,
        title: c.name,
        subtitle: c.provider ?? c.category,
        keywords: [c.provider, c.notes, c.category].filter(Boolean).join(' '),
      });
    }
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
  if (!hidden.has('setup')) {
    for (const s of setupItems) {
      if (s.deleted) continue;
      hits.push({
        section: 'setup',
        sectionLabel: SECTION_LABELS.setup,
        id: s.id,
        title: s.name,
        subtitle: s.room,
        keywords: [s.where_to_buy, s.notes, s.room].filter(Boolean).join(' '),
        href: SECTION_PATHS.setup,
      });
    }
  }

  // ── Calendar / Appointments ───────────────────────────────────────────────
  if (!hidden.has('search')) {
    for (const a of appointments) {
      const apt = apartments.find((ap) => ap.id === a.apartment_id);
      const label = apt?.address || a.notes || 'Viewing';
      hits.push({
        section: 'calendar',
        sectionLabel: SECTION_LABELS.calendar,
        id: a.id,
        title: label,
        subtitle: a.status,
        keywords: [a.notes].filter(Boolean).join(' '),
        href: SECTION_PATHS.calendar,
      });
    }
  }

  // ── Checklist ─────────────────────────────────────────────────────────────
  if (!hidden.has('search')) {
    for (const c of checklistItems) {
      hits.push({
        section: 'checklist',
        sectionLabel: SECTION_LABELS.checklist,
        id: c.id,
        title: c.label,
        subtitle: c.category,
        keywords: c.category,
        href: SECTION_PATHS.checklist,
      });
    }
  }

  // ── Home Search / Apartments ──────────────────────────────────────────────
  if (!hidden.has('search')) {
    for (const ap of apartments) {
      hits.push({
        section: 'search',
        sectionLabel: SECTION_LABELS.search,
        id: ap.id,
        title: ap.address,
        subtitle: ap.suburb ?? ap.main_location ?? undefined,
        keywords: [ap.suburb, ap.main_location, ap.notes].filter(Boolean).join(' '),
        href: `/apartment/${ap.id}`,
      });
    }
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  if (!hidden.has('documents')) {
    for (const d of documents) {
      hits.push({
        section: 'documents',
        sectionLabel: SECTION_LABELS.documents,
        id: d.key,
        title: d.title ?? d.filename,
        subtitle: d.docType,
        keywords: [d.filename, ...(d.tags ?? [])].filter(Boolean).join(' '),
        href: SECTION_PATHS.documents,
      });
    }
  }

  // ── Recipes ───────────────────────────────────────────────────────────────
  if (!hidden.has('recipes')) {
    for (const r of recipes) {
      if (r.deleted) continue;
      hits.push({
        section: 'recipes',
        sectionLabel: SECTION_LABELS.recipes,
        id: r.id,
        title: r.title,
        // HOUP-333: cuisines can be absent on legacy/malformed rows — read via the
        // shared guard, or the layout-level search index memo crashes the whole shell.
        subtitle: recipeCuisines(r).join(', ') || undefined,
        keywords: [r.method, ...recipeCuisines(r)].filter(Boolean).join(' '),
        href: `/recipes/${r.id}`,
      });
    }
  }

  // ── Household Checklists ─────────────────────────────────────────────────
  if (!hidden.has('checklists')) {
    for (const c of checklists) {
      if (c.deleted) continue;
      hits.push({
        section: 'checklists',
        sectionLabel: SECTION_LABELS.checklists,
        id: c.id,
        title: c.title,
        subtitle: c.completed_at ? 'Completed' : c.type,
        keywords: c.type,
        href: `/checklists/${c.id}`,
      });
    }
  }

  return hits;
}

export function useGlobalSearchIndex({
  supabase,
  groupId,
  hiddenSections,
  tasks,
  groceries,
  costItems,
  setupItems,
  appointments,
  apartments,
  checklistItems,
  recipes,
  checklists,
  documentStoreRows,
}: UseGlobalSearchIndexArgs): { index: GlobalHit[]; docsLoading: boolean } {
  const [documents, setDocuments] = useState<UnifiedDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const documentsHidden = hiddenSections.includes('documents');
  // Legacy bill files and grocery receipts are searchable only while their
  // module is on (module-features.ts).
  const { feature } = useModules();
  const costsOn = feature('documents.costs');
  const groceriesOn = feature('documents.groceries');

  useEffect(() => {
    if (!groupId || documentsHidden) return;
    setDocsLoading(true);
    listUnifiedDocuments(supabase, groupId, documentStoreRows, { costs: costsOn, groceries: groceriesOn })
      .then(setDocuments)
      .catch(() => {})
      .finally(() => setDocsLoading(false));
    // documentsHidden (not hiddenSections) so unrelated section toggles don't
    // trigger a needless re-fetch — only un-hiding documents itself does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, documentsHidden, supabase, documentStoreRows, costsOn, groceriesOn]);

  const index = useMemo<GlobalHit[]>(
    () =>
      buildGlobalHits({
        hiddenSections,
        tasks,
        groceries,
        costItems,
        setupItems,
        appointments,
        apartments,
        checklistItems,
        documents,
        recipes,
        checklists,
      }),
    [hiddenSections, tasks, groceries, costItems, setupItems, appointments, apartments, checklistItems, documents, recipes, checklists]
  );

  return { index, docsLoading };
}
