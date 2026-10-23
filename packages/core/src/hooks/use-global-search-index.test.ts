import { describe, expect, it } from 'vitest';
import { buildGlobalHits, resolveGlobalHitAction, type GlobalHit } from './use-global-search-index';
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
import type { UnifiedDocument } from '../documents';
import { ALL_MODULE_IDS, hiddenWithDisabledModules, type ModuleId } from '../modules';

// HOUP-147: unit coverage for the pure hit-building/action-resolution logic
// behind useGlobalSearchIndex — this package's vitest environment is `node`
// (no jsdom/testing-library), so the hook itself isn't rendered; see
// use-fuzzy-search.test.ts for the same convention.

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

const EMPTY_ARGS = {
  hiddenSections: [] as string[],
  tasks: [] as HouseholdTask[],
  groceries: [] as GroceryItem[],
  costItems: [] as CostItem[],
  setupItems: [] as SetupItem[],
  appointments: [] as Appointment[],
  apartments: [] as { id: string; address: string; suburb?: string | null; main_location?: string | null; notes?: string | null }[],
  checklistItems: [] as ChecklistItem[],
  documents: [] as UnifiedDocument[],
  recipes: [] as Recipe[],
  checklists: [] as Checklist[],
};

describe('buildGlobalHits', () => {
  it('excludes a hidden section entirely', () => {
    const hits = buildGlobalHits({ ...EMPTY_ARGS, tasks: [task()] });
    expect(hits.some((h) => h.section === 'tasks')).toBe(true);

    const hiddenHits = buildGlobalHits({ ...EMPTY_ARGS, hiddenSections: ['household'], tasks: [task()] });
    expect(hiddenHits.some((h) => h.section === 'tasks')).toBe(false);
  });

  it('skips soft-deleted rows', () => {
    const hits = buildGlobalHits({
      ...EMPTY_ARGS,
      groceries: [grocery({ id: 'g1' }), grocery({ id: 'g2', deleted: true })],
    });
    expect(hits.map((h) => h.id)).toEqual(['g1']);
  });

  it('gates calendar, checklist, and apartment hits on the "search" hidden key, not their own section names', () => {
    const args = {
      ...EMPTY_ARGS,
      appointments: [appointment()],
      checklistItems: [checklistItem()],
      apartments: [{ id: 'apt-1', address: '1 Main St' }],
    };

    const shown = buildGlobalHits(args);
    expect(shown.map((h) => h.section).sort()).toEqual(['calendar', 'checklist', 'search']);

    // Hiding 'calendar' (the SectionKey's own name) does nothing — the hook
    // gates all three on 'search' visibility instead.
    const stillShown = buildGlobalHits({ ...args, hiddenSections: ['calendar'] });
    expect(stillShown.map((h) => h.section).sort()).toEqual(['calendar', 'checklist', 'search']);

    const hidden = buildGlobalHits({ ...args, hiddenSections: ['search'] });
    expect(hidden).toEqual([]);
  });

  it('stamps setup hits with href: "/setup"', () => {
    const hits = buildGlobalHits({ ...EMPTY_ARGS, setupItems: [setupItem()] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ section: 'setup', href: '/setup' });
  });

  it('includes documents passed in directly (the hook fetches them; this fn just renders the list)', () => {
    const doc: UnifiedDocument = {
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
    const hits = buildGlobalHits({ ...EMPTY_ARGS, documents: [doc] });
    expect(hits).toEqual([
      expect.objectContaining({ section: 'documents', id: 'doc-1', title: 'Lease', href: '/documents' }),
    ]);
  });

  it('builds recipe and checklist hits with their own per-item hrefs', () => {
    const hits = buildGlobalHits({
      ...EMPTY_ARGS,
      recipes: [recipe({ id: 'r1' })],
      checklists: [checklist({ id: 'c1' })],
    });
    expect(hits).toEqual([
      expect.objectContaining({ section: 'recipes', id: 'r1', href: '/recipes/r1' }),
      expect.objectContaining({ section: 'checklists', id: 'c1', href: '/checklists/c1' }),
    ]);
  });
});

describe('resolveGlobalHitAction', () => {
  const baseHit: GlobalHit = {
    section: 'tasks',
    sectionLabel: 'Tasks',
    id: 'hit-1',
    title: 'Hit',
    keywords: '',
  };

  it.each(['tasks', 'groceries', 'costs'] as const)('resolves %s hits to a modal action', (section) => {
    const action = resolveGlobalHitAction({ ...baseHit, section });
    expect(action).toEqual({ kind: 'modal', section, id: 'hit-1' });
  });

  it('resolves setup to a nav action at /setup', () => {
    const action = resolveGlobalHitAction({ ...baseHit, section: 'setup', href: '/setup' });
    expect(action).toEqual({ kind: 'nav', href: '/setup' });
  });

  it.each(['calendar', 'checklist', 'search', 'documents', 'recipes', 'shopper', 'checklists'] as const)(
    'resolves %s hits to a nav action',
    (section) => {
      const action = resolveGlobalHitAction({ ...baseHit, section, href: '/somewhere' });
      expect(action.kind).toBe('nav');
    }
  );

  it('prefers the per-item href over the section-level fallback', () => {
    const action = resolveGlobalHitAction({ ...baseHit, section: 'documents', href: '/documents/custom-doc' });
    expect(action).toEqual({ kind: 'nav', href: '/documents/custom-doc' });
  });
});

// Modules (.docs/modules.md): search gates on the person's hidden list plus
// every switched-off module (hiddenWithDisabledModules). Turning one module
// off must remove exactly that module's results and leave everyone else's.
describe('buildGlobalHits with a module switched off', () => {
  const ALL_ROWS = {
    ...EMPTY_ARGS,
    tasks: [task()],
    groceries: [grocery()],
    costItems: [costItem()],
    setupItems: [setupItem()],
    appointments: [appointment()],
    apartments: [{ id: 'apt-1', address: '1 Main St' }],
    checklistItems: [checklistItem()],
    documents: [
      {
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
      } satisfies UnifiedDocument,
    ],
    recipes: [recipe()],
    checklists: [checklist()],
    shopperWants: [
      {
        id: 'want-1',
        group_id: 'group-1',
        title: 'Sony Bravia 7',
        query: null,
        target_cents: null,
        budget_cents: null,
        status: 'watching' as const,
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
      },
    ],
  };

  // Which module owns each kind of hit. Viewings (calendar) and the apartment
  // checklist belong to Home Search, not to Calendar or Checklists.
  const MODULE_OF_HIT: Record<GlobalHit['section'], ModuleId> = {
    tasks: 'household',
    groceries: 'groceries',
    costs: 'costs',
    setup: 'setup',
    calendar: 'search',
    checklist: 'search',
    search: 'search',
    documents: 'documents',
    recipes: 'recipes',
    shopper: 'shopper',
    checklists: 'checklists',
  };

  const modulesWithHits = (hits: GlobalHit[]) => new Set(hits.map((h) => MODULE_OF_HIT[h.section]));

  it('finds a result from every module that has searchable rows when all are on', () => {
    const hits = buildGlobalHits({
      ...ALL_ROWS,
      hiddenSections: hiddenWithDisabledModules([], new Set(ALL_MODULE_IDS)),
    });
    // Calendar has no rows of its own in search yet, Google Calendar and MCP
    // are integrations with no rows at all, assistant chats aren't searched,
    // Rewards answers store searches on its own screen, and Money insights
    // only adds a card to Costs.
    const noRows = new Set(['calendar', 'google-calendar', 'mcp', 'assistant', 'rewards', 'money-insights']);
    expect([...modulesWithHits(hits)].sort()).toEqual(ALL_MODULE_IDS.filter((id) => !noRows.has(id)).sort());
  });

  it.each(ALL_MODULE_IDS)('turning %s off removes only its results', (off) => {
    const on = new Set(ALL_MODULE_IDS.filter((id) => id !== off));
    const before = modulesWithHits(
      buildGlobalHits({ ...ALL_ROWS, hiddenSections: hiddenWithDisabledModules([], new Set(ALL_MODULE_IDS)) })
    );
    const after = modulesWithHits(buildGlobalHits({ ...ALL_ROWS, hiddenSections: hiddenWithDisabledModules([], on) }));
    before.delete(off);
    expect(after).toEqual(before);
  });

  it('finds nothing, without throwing, when every module is off', () => {
    expect(buildGlobalHits({ ...ALL_ROWS, hiddenSections: hiddenWithDisabledModules([], new Set()) })).toEqual([]);
  });

  it("keeps the person's own hidden sections hidden alongside switched-off modules", () => {
    const on = new Set(ALL_MODULE_IDS.filter((id) => id !== 'groceries'));
    const hits = buildGlobalHits({ ...ALL_ROWS, hiddenSections: hiddenWithDisabledModules(['costs'], on) });
    const found = modulesWithHits(hits);
    expect(found.has('groceries')).toBe(false);
    expect(found.has('costs')).toBe(false);
    expect(found.has('household')).toBe(true);
  });
});
