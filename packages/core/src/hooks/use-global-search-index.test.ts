// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveGlobalHitAction, type GlobalHit } from './use-global-search-index';
import { SEARCH_SOURCES, useSearchHits } from '../slots/search';
import type { SearchSource } from '../slots/types';
import { ALL_MANIFESTS } from '../module-manifests';
import { getSection } from '../sections';
import { tasksSearchHits } from '../modules/household/slots';
import { groceriesSearchHits } from '../modules/groceries/slots';
import { costsSearchHits } from '../modules/costs/slots';
import { setupSearchHits } from '../modules/setup/slots';
import { homeSearchHits } from '../modules/search/slots';
import { documentsSearchHits } from '../modules/documents/slots';
import { recipesSearchHits } from '../modules/recipes/slots';
import { shopperSearchHits } from '../modules/shopper/slots';
import { checklistsSearchHits } from '../modules/checklists/slots';
import { eventsSearchHits } from '../modules/calendar/slots';
import { occasionsSearchHits } from '../modules/occasions/slots';
import { rewardsSearchHits } from '../modules/rewards/slots';
// new-module:search-fixture-import (a new module's search builder is imported above this line)
import type { ShopperWant } from '../modules/shopper/shopper';
import type {
  Appointment,
  Checklist,
  ChecklistItem,
  CostItem,
  GroceryItem,
  HouseholdTask,
  Recipe,
  SetupItem,
} from '../types';
import type { UnifiedDocument } from '../modules/documents/documents';
import { ALL_MODULE_IDS, hiddenWithDisabledModules } from '../modules';

// HOUP-147: unit coverage for each module's pure search builder (its
// slots.ts), the search slot's gating (core slots/search.ts) and the
// nav-vs-modal decision.

function task(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 'task-1',
    group_id: 'group-1',
    title: 'Wash dishes',
    due_date: null,
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function grocery(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'grocery-1',
    group_id: 'group-1',
    name: 'Milk',
    aisle: 'dairy',
    quantity: null,
    unit: null,
    status: 'needed',
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    recurrence_days: null,
    status_changed_at: null,
    last_purchased_at: null,
    last_price: null,
    lowest_price: null,
    expiry_date: null,
    shelf_life_days: null,
    price_cents: null,
    is_essential: false,
    recipe_note: null,
    recipe_source_id: null,
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
    ...overrides,
  };
}

function costItem(overrides: Partial<CostItem> = {}): CostItem {
  return {
    id: 'cost-1',
    group_id: 'group-1',
    name: 'Internet',
    category: 'internet',
    amount: 8000,
    cadence: 'monthly',
    is_estimate: false,
    start_date: null,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function setupItem(overrides: Partial<SetupItem> = {}): SetupItem {
  return {
    id: 'setup-1',
    group_id: 'group-1',
    name: 'Vacuum',
    room: 'Living room',
    priority: 'medium',
    status: 'needed',
    est_price: null,
    actual_price: null,
    where_to_buy: null,
    store_id: null,
    url: null,
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    ai_suggestion: null,
    sort_order: 0,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    user_id: 'user-1',
    group_id: 'group-1',
    apartment_id: 'apt-1',
    scheduled_at: '2026-06-20T10:00:00.000Z',
    notes: null,
    status: 'scheduled',
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function checklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'ci-1',
    user_id: 'user-1',
    group_id: 'group-1',
    label: 'Check water pressure',
    category: 'Plumbing',
    weight: 5,
    is_dealbreaker: false,
    is_bonus: false,
    order: 0,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    group_id: 'group-1',
    title: 'Lasagna',
    cuisines: [],
    method: null,
    instructions: null,
    servings: null,
    prep_minutes: null,
    cook_minutes: null,
    source: null,
    source_type: null,
    draft: false,
    created_by: null,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function checklist(overrides: Partial<Checklist> = {}): Checklist {
  return {
    id: 'checklist-1',
    group_id: 'group-1',
    title: 'Move-in checklist',
    type: 'plain',
    template_key: null,
    source_checklist_id: null,
    completed_at: null,
    scheduled_date: null,
    linked_task_id: null,
    log_costs: false,
    repeat_cadence_days: null,
    repeat_renewal_mode: null,
    created_by: null,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}


const DOC: UnifiedDocument = {
  key: 'doc-1',
  storeId: 'doc-1',
  title: 'Lease',
  filename: 'lease.pdf',
  docType: 'lease',
  source: 'capture',
  createdAt: '2026-06-15T00:00:00.000Z',
  storagePath: 'group-1/lease.pdf',
  bucket: 'documents',
  folderId: null,
  legacy: false,
  groupId: 'group-1',
  expiryDate: null,
  tags: [],
  metadata: {},
  uploadedBy: null,
};

const WANT: ShopperWant = {
  id: 'want-1',
  group_id: 'group-1',
  title: 'Sony Bravia 7',
  query: null,
  target_cents: null,
  budget_cents: null,
  status: 'watching',
  need_by: null,
  notes: null,
  best_cents: null,
  best_store: null,
  last_checked_at: null,
  bought_at: null,
  created_by: null,
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
  deleted: false,
};

describe("each module's search builder", () => {
  it('skips soft-deleted rows', () => {
    expect(groceriesSearchHits([grocery({ id: 'g1' }), grocery({ id: 'g2', deleted: true })]).map((h) => h.id)).toEqual(['g1']);
    expect(tasksSearchHits([task({ deleted: true })])).toEqual([]);
  });

  it("puts viewings, the viewing checklist and listings under Home Search's tile", () => {
    const hits = homeSearchHits({
      appointments: [appointment()],
      checklistItems: [checklistItem()],
      apartments: [{ id: 'apt-1', address: '1 Main St' }],
    });
    expect(hits.map((h) => [h.section, h.sectionId, h.href])).toEqual([
      ['calendar', 'calendar', '/calendar'],
      ['checklist', 'search', '/checklist'],
      ['search', 'search', '/apartment/apt-1'],
    ]);
    expect(hits[0].title).toBe('1 Main St');
  });

  it('stamps setup hits with href: "/setup"', () => {
    expect(setupSearchHits([setupItem()])).toEqual([expect.objectContaining({ section: 'setup', sectionId: 'setup', href: '/setup' })]);
  });

  it('lists documents it is given', () => {
    expect(documentsSearchHits([DOC])).toEqual([
      expect.objectContaining({ section: 'documents', id: 'doc-1', title: 'Lease', href: '/documents' }),
    ]);
  });

  it('builds recipe, checklist and Shopper hits with their own per-item hrefs', () => {
    expect(recipesSearchHits([recipe({ id: 'r1' })])).toEqual([expect.objectContaining({ section: 'recipes', id: 'r1', href: '/recipes/r1' })]);
    expect(checklistsSearchHits([checklist({ id: 'c1' })])).toEqual([
      expect.objectContaining({ section: 'checklists', id: 'c1', href: '/checklists/c1' }),
    ]);
    expect(shopperSearchHits([WANT])).toEqual([expect.objectContaining({ section: 'shopper', href: '/shopper/want-1' })]);
  });

  it('gives tasks, groceries and costs no href: they open their editor', () => {
    const hits = [...tasksSearchHits([task()]), ...groceriesSearchHits([grocery()]), ...costsSearchHits([costItem()])];
    expect(hits.map((h) => [h.section, h.sectionId, h.href])).toEqual([
      ['tasks', 'household', undefined],
      ['groceries', 'groceries', undefined],
      ['costs', 'costs', undefined],
    ]);
  });
});

describe('resolveGlobalHitAction', () => {
  const baseHit: GlobalHit = {
    section: 'tasks',
    sectionId: 'household',
    sectionLabel: 'Tasks',
    id: 'hit-1',
    title: 'Hit',
    keywords: '',
  };

  it.each(['tasks', 'groceries', 'costs'] as const)('resolves %s hits to a modal action', (section) => {
    const action = resolveGlobalHitAction({ ...baseHit, section });
    expect(action).toEqual({ kind: 'modal', section, id: 'hit-1' });
  });

  it.each(['setup', 'calendar', 'checklist', 'search', 'documents', 'recipes', 'shopper', 'checklists', 'a-new-module'])(
    'resolves %s hits to a nav action at their href',
    (section) => {
      expect(resolveGlobalHitAction({ ...baseHit, section, href: '/somewhere' })).toEqual({ kind: 'nav', href: '/somewhere' });
    }
  );
});

// One row of every kind, built by each module's own builder.
const HITS_BY_MODULE: Record<string, GlobalHit[]> = {
  household: tasksSearchHits([task()]),
  groceries: groceriesSearchHits([grocery()]),
  costs: costsSearchHits([costItem()]),
  setup: setupSearchHits([setupItem()]),
  search: homeSearchHits({ appointments: [appointment()], apartments: [{ id: 'apt-1', address: '1 Main St' }], checklistItems: [checklistItem()] }),
  documents: documentsSearchHits([DOC]),
  recipes: recipesSearchHits([recipe()]),
  shopper: shopperSearchHits([WANT]),
  checklists: checklistsSearchHits([checklist()]),
  calendar: eventsSearchHits([{ id: 'event-1', title: 'Dinner at Sam\'s', starts_at: '2026-06-20T08:00:00.000Z', is_all_day: false, location: 'Fitzroy', notes: null, deleted: false } as never]),
  occasions: occasionsSearchHits([{ id: 'occasion-1', title: "Mum's birthday", kind: 'birthday', deleted: false } as never]),
  rewards: rewardsSearchHits(
    [{ id: 'scheme-1', name: 'Flybuys', kind: 'loyalty', notes: null, deleted: false } as never],
    [{ id: 'partner-1', scheme_id: 'scheme-1', name: 'Coles', deleted: false } as never],
    [],
  ),
  // new-module:search-fixture (a new module's fixture row goes above this line)
};

/** The registry, each source swapped for one that returns its module's fixture rows. */
const FIXTURE_SOURCES: SearchSource[] = SEARCH_SOURCES.map((s) => ({
  moduleId: s.moduleId,
  useHits: ({ groupId }) => ({ hits: groupId ? HITS_BY_MODULE[s.moduleId] ?? [] : [] }),
}));

function search(hiddenSections: string[]): GlobalHit[] {
  const { result } = renderHook(() => useSearchHits({ supabase: null, groupId: 'group-1', hiddenSections }, FIXTURE_SOURCES));
  return result.current.index;
}

const MODULE_OF = new Map(Object.entries(HITS_BY_MODULE).flatMap(([moduleId, hits]) => hits.map((h) => [`${h.section}:${h.id}`, moduleId] as const)));
const modulesWithHits = (hits: GlobalHit[]) => new Set(hits.map((h) => MODULE_OF.get(`${h.section}:${h.id}`)));

describe('search slot registry', () => {
  it('has one source for each module whose manifest lists the search slot, with fixture rows for each', () => {
    const declared = ALL_MANIFESTS.filter((m) => m.slots?.includes('search')).map((m) => m.id).sort();
    expect(SEARCH_SOURCES.map((s) => s.moduleId).sort()).toEqual(declared);
    expect(Object.keys(HITS_BY_MODULE).sort()).toEqual(declared);
  });

  it("gives every hit a real section's tile", () => {
    for (const hit of Object.values(HITS_BY_MODULE).flat()) expect(getSection(hit.sectionId), hit.section).toBeDefined();
  });
});

// Modules (.docs/modules.md): search gates on the person's hidden list plus
// every switched-off module (hiddenWithDisabledModules). Turning one module
// off must remove exactly that module's results and leave everyone else's.
describe('search with a module switched off', () => {
  const allOn = () => hiddenWithDisabledModules([], new Set(ALL_MODULE_IDS));

  it('finds a result from every module with a search source when all are on, in registry order', () => {
    const hits = search(allOn());
    expect([...modulesWithHits(hits)]).toEqual(SEARCH_SOURCES.map((s) => s.moduleId));
  });

  it.each(ALL_MODULE_IDS)('turning %s off removes only its results', (off) => {
    const before = modulesWithHits(search(allOn()));
    const after = modulesWithHits(search(hiddenWithDisabledModules([], new Set(ALL_MODULE_IDS.filter((id) => id !== off)))));
    before.delete(off);
    expect(after).toEqual(before);
  });

  it('finds nothing, without throwing, when every module is off', () => {
    expect(search(hiddenWithDisabledModules([], new Set()))).toEqual([]);
  });

  it("keeps the person's own hidden sections hidden alongside switched-off modules", () => {
    const found = modulesWithHits(search(hiddenWithDisabledModules(['costs'], new Set(ALL_MODULE_IDS.filter((id) => id !== 'groceries')))));
    expect(found.has('groceries')).toBe(false);
    expect(found.has('costs')).toBe(false);
    expect(found.has('household')).toBe(true);
  });
});

describe('module search builders added with the slot', () => {
  it('opens an event on its day in the Calendar', () => {
    expect(HITS_BY_MODULE.calendar[0]).toMatchObject({ section: 'events', sectionId: 'calendar', href: '/calendar?date=2026-06-20' });
  });

  it("finds a rewards scheme by one of its partner stores", () => {
    expect(HITS_BY_MODULE.rewards[0].keywords).toContain('Coles');
  });
});
