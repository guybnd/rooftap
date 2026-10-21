// HOUP-136: the global capture sheet — a section-tile launcher grid, ported
// from apps/web/src/components/capture/capture-sheet.tsx's `launcherActions`
// (minus the in-sheet search/"Add as…" flow, since landed by HOUP-147).
// Tapping a compose tile (To-do/Grocery/Cost/Setup/Doc) mounts that section's
// existing native form sheet at the bottom of this component and CaptureSheet
// itself owns the write — the form sheets only bubble the built row (see each
// sheet's own onSave), exactly like the index screens' useStoreHelpers().
// Navigate tiles (Apartment/Recipe/Calendar/Viewing checklist/Checklist) just
// route + close. Mounted once at shell level inside DataCacheProvider
// (apps/mobile/src/app/_layout.tsx) so it always has the active groupId.
//
// HOUP-147: typing in the search box swaps the tile grid for cross-section
// results (packages/core's useGlobalSearchIndex, the same index web's
// capture-sheet builds) + "Add '<query>' as…" quick-create chips for
// To-do/Grocery/Cost — mirrors web's capture-sheet.tsx search step.
//
// Hearth v2 polish: each launcher tile leads with its section's identity
// tile (LeadingTile, the same hue the tab bar wears for that section), and a
// search hit renders as its section's real line item (CaptureSearchResults):
// a found to-do swipes, ticks and holds exactly as on the Tasks screen.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { usePathname } from 'expo-router';
import { use$ } from '@legendapp/state/react';
import {
  Building2,
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  Home,
  ListChecks,
  ListTodo,
  Plus,
  ScanLine,
  ShoppingCart,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { Text, BottomSheet, LeadingTile, SectionSearchBar, ToastHost, cn, useThemeMaterial } from '@homeup/ui';
import {
  apartmentChecklistItems$,
  apartments$,
  appointments$,
  checklists$,
  costItems$,
  documents$,
  getEnabledSections,
  groceryItems$,
  hiddenWithDisabledModules,
  householdTasks$,
  listDocumentTags,
  listSetupStores,
  recipes$,
  shopperWants$,
  sectionHueSwatch,
  setupItems$,
  useModules,
  syncedGroupId,
  useReconnectSync,
  useStoreHelpers,
  type Apartment,
  type Appointment,
  type Checklist,
  type ChecklistItem,
  type CostItem,
  type Document,
  type GroceryItem,
  type HouseholdTask,
  type Recipe,
  type ShopperWant,
  type SetupItem,
  type SetupStore,
} from '@homeup/core';
import { useGlobalSearchIndex, resolveGlobalHitAction, type GlobalHit } from '@homeup/core/src/hooks/use-global-search-index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useDataCache } from '@/lib/data-cache';
import { getBoundSupabaseClient, getCurrentSupabaseClient } from '@/lib/supabase-client';
import { useCapture } from '@/components/capture/capture-context';
import { CaptureSearchResults } from '@/components/capture/capture-search-results';
import { CaptureFlow } from '@/components/documents/capture-flow';
import { HouseholdTaskModal } from '@/features/tasks/household-task-modal';
import { GroceryItemFormSheet } from '@/features/groceries/grocery-item-form-sheet';
import { useGroceryAux } from '@/features/groceries/use-grocery-aux';
import { CostModal } from '@/features/costs/cost-modal';
import { SetupItemSheet } from '@/features/setup/setup-item-sheet';
import { useOpenRoute } from '@/lib/tab-routes';

type ComposeKind = 'todo' | 'grocery' | 'cost' | 'setup' | 'doc';

interface LauncherAction {
  key: string;
  label: string;
  /** Section id (from sections.ts) whose enablement gates this tile. */
  section: string;
  icon: LucideIcon;
  /** Disable + dim when offline (needs a network round-trip). */
  onlineOnly?: boolean;
  run: () => void;
}

export function CaptureSheet() {
  const { open, setOpen, closeCapture } = useCapture();
  const { group, isOnline, currentUserId, groupMembers, memberProfiles, userSettings } = useDataCache();
  const groupId = group?.id ?? null;
  const openRoute = useOpenRoute();

  const [activeModal, setActiveModal] = React.useState<ComposeKind | null>(null);
  const [groupTags, setGroupTags] = React.useState<string[]>([]);

  // Quick-create targets from a search hit or an "Add as…" chip (HOUP-147).
  // Mirrors web's editingTask/newTaskTitle triad per type — `key`-remounting
  // the form sheet on these re-seeds it without a resync effect.
  const [editingTask, setEditingTask] = React.useState<HouseholdTask | undefined>();
  const [newTaskTitle, setNewTaskTitle] = React.useState('');
  const [editingGrocery, setEditingGrocery] = React.useState<GroceryItem | undefined>();
  const [newGroceryName, setNewGroceryName] = React.useState('');
  const [editingCost, setEditingCost] = React.useState<CostItem | undefined>();
  const [newCostName, setNewCostName] = React.useState('');
  // A setup hit's tap/hold opens its editor (a blank one from the Setup tile).
  const [editingSetup, setEditingSetup] = React.useState<SetupItem | undefined>();
  const [setupStores, setSetupStores] = React.useState<SetupStore[]>([]);

  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  // Anything inside the sheet that navigates (a task's "from Costs" link, a
  // checklist panel's "Open", a grocery's recipe chip) leaves the sheet
  // behind; close it so the destination isn't hidden under it.
  const pathname = usePathname();
  const openPathname = React.useRef(pathname);
  React.useEffect(() => {
    if (open) openPathname.current = pathname;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (open && pathname !== openPathname.current) closeCapture();
  }, [open, pathname, closeCapture]);

  // Identity hues for the launcher tiles' and chips' glyphs (Hearth v2).
  const { scheme } = useThemeMaterial();

  // Modules (.docs/modules.md): a switched-off module offers no quick-add and
  // no search results, the same as a section the person hid.
  const modules = useModules();
  const enabledSectionIds = React.useMemo(
    () => new Set(getEnabledSections(modules.enabled).map((s) => s.id)),
    [modules.enabled]
  );
  const hiddenSections = React.useMemo(
    () => hiddenWithDisabledModules(userSettings?.hidden_sections, modules.enabled),
    [userSettings?.hidden_sections, modules.enabled]
  );

  // Legend stores backing the compose sheets. Activated unconditionally (mirrors
  // web CaptureSheet) — CaptureSheet is a shell-level singleton, so this is the
  // sheet's only chance to own the write; a dormant/unhydrated store would
  // silently drop the row. Modules (store-modules.ts): a switched-off module's
  // stores open with no group id, so they don't sync; nothing here writes to
  // one, because every compose sheet and search hit for it is gone too.
  const syncedGroup = (store$: { collection: string }) => syncedGroupId(store$, groupId, modules.enabled);
  const tasks$ = householdTasks$(syncedGroup(householdTasks$));
  const groceries$ = groceryItems$(syncedGroup(groceryItems$));
  const costs$ = costItems$(syncedGroup(costItems$));
  const setup$ = setupItems$(syncedGroup(setupItems$));
  useReconnectSync(tasks$);
  useReconnectSync(groceries$);
  useReconnectSync(costs$);
  useReconnectSync(setup$);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: softDeleteTask } = useStoreHelpers(tasks$, currentUserId);
  const { writeRow: writeGrocery, patchRow: patchGrocery } = useStoreHelpers(groceries$, currentUserId);
  const { writeRow: writeCost, patchRow: patchCost, softDeleteRow: softDeleteCost } = useStoreHelpers(costs$, currentUserId);
  const { writeRow: writeSetup, patchRow: patchSetup, softDeleteRow: softDeleteSetup } = useStoreHelpers(setup$, currentUserId);
  const groceryAux = useGroceryAux(modules.isEnabled('groceries') ? groupId : null);

  const tasks = use$(() => Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted));
  const groceries = use$(() => Object.values(groceries$.get() ?? {}).filter((g): g is GroceryItem => !!g && !g.deleted));
  const costItemsList = use$(() => Object.values(costs$.get() ?? {}).filter((c): c is CostItem => !!c && !c.deleted));
  const setupItemsList = use$(() => Object.values(setup$.get() ?? {}).filter((s): s is SetupItem => !!s && !s.deleted));

  // Read-only stores that only back the search index — gated on `open` (the
  // only surface search runs from) rather than unconditionally, unlike the
  // write-target stores above.
  const appointments$store = appointments$(syncedGroup(appointments$));
  const apartments$store = apartments$(syncedGroup(apartments$));
  const checklistItems$store = apartmentChecklistItems$(syncedGroup(apartmentChecklistItems$));
  const recipes$store = recipes$(syncedGroup(recipes$));
  const checklists$store = checklists$(syncedGroup(checklists$));
  const documents$store = documents$(syncedGroup(documents$));
  const shopper$store = shopperWants$(syncedGroup(shopperWants$));
  useReconnectSync(appointments$store);
  useReconnectSync(apartments$store);
  useReconnectSync(checklistItems$store);
  useReconnectSync(recipes$store);
  useReconnectSync(checklists$store);
  useReconnectSync(documents$store);
  useReconnectSync(shopper$store);
  const appointments = use$(() =>
    open ? Object.values(appointments$store.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted) : []
  );
  const apartments = use$(() =>
    open ? Object.values(apartments$store.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted) : []
  );
  const checklistItems = use$(() =>
    open ? Object.values(checklistItems$store.get() ?? {}).filter((c): c is ChecklistItem => !!c && !c.deleted) : []
  );
  const recipesList = use$(() =>
    open ? Object.values(recipes$store.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted) : []
  );
  const checklistsList = use$(() =>
    open ? Object.values(checklists$store.get() ?? {}).filter((c): c is Checklist => !!c && !c.deleted) : []
  );
  const shopperList = use$(() =>
    open ? Object.values(shopper$store.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted) : []
  );
  const documentRows = use$(() =>
    open ? Object.values(documents$store.get() ?? {}).filter((d): d is Document => !!d && !d.deleted) : []
  );

  // getCurrentSupabaseClient() throws before the app's cold-boot binds a
  // client; the bound (non-throwing) getter is safe here because the core
  // hook's own doc fetch is gated on a non-empty groupId, which never
  // happens before boot binds a client.
  const boundSupabase = getBoundSupabaseClient();
  const { index: searchIndex, docsLoading } = useGlobalSearchIndex({
    supabase: boundSupabase as SupabaseClient,
    groupId: open ? (groupId ?? '') : '',
    hiddenSections,
    tasks,
    groceries,
    costItems: costItemsList,
    setupItems: setupItemsList,
    appointments,
    apartments,
    checklistItems,
    recipes: recipesList,
    checklists: checklistsList,
    documentStoreRows: documentRows,
    shopperWants: shopperList,
  });

  // Setup stores name a setup row's store and back its editor's store picker
  // (fetched like the Setup screen does, once the sheet or editor opens).
  const setupOn = modules.isEnabled('setup');
  React.useEffect(() => {
    if (!groupId || !setupOn || !(open || activeModal === 'setup')) return;
    let cancelled = false;
    try {
      listSetupStores(getCurrentSupabaseClient(), groupId)
        .then((rows) => {
          if (!cancelled) setSetupStores(rows);
        })
        .catch(() => {});
    } catch {
      // Client not bound yet: rows render without a store name.
    }
    return () => {
      cancelled = true;
    };
  }, [groupId, setupOn, open, activeModal]);

  // The Doc tile's groupTags aren't exposed by useDataCache() — fetch them the
  // same way apps/mobile/src/app/(tabs)/documents/index.tsx does.
  React.useEffect(() => {
    if (activeModal !== 'doc' || !groupId) return;
    const supabase = getCurrentSupabaseClient();
    listDocumentTags(supabase, groupId).then(setGroupTags).catch(() => {});
  }, [activeModal, groupId]);

  const openCompose = (kind: ComposeKind) => {
    setActiveModal(kind);
    closeCapture();
  };

  const navigateTo = (href: string) => {
    closeCapture();
    openRoute(href);
  };

  const openGroceryEdit = (g: GroceryItem) => {
    setEditingGrocery(g);
    setNewGroceryName('');
    setActiveModal('grocery');
    closeCapture();
  };

  // Clicking a search hit: open the matching edit sheet (tasks/groceries/costs)
  // or navigate to the item's section — resolveGlobalHitAction is the single
  // source of the nav-vs-modal decision (also consumed by web's capture-sheet).
  const handleHitClick = (hit: GlobalHit) => {
    const action = resolveGlobalHitAction(hit);
    if (action.kind === 'nav') {
      if (action.href) navigateTo(action.href);
      return;
    }
    switch (action.section) {
      case 'tasks': {
        const t = tasks.find((x) => x.id === action.id);
        if (t) openTaskEdit(t);
        return;
      }
      case 'groceries': {
        const g = groceries.find((x) => x.id === action.id);
        if (g) openGroceryEdit(g);
        return;
      }
      case 'costs': {
        const c = costItemsList.find((x) => x.id === action.id);
        if (c) openCostEdit(c);
        return;
      }
    }
  };

  const openTaskEdit = (t: HouseholdTask) => {
    setEditingTask(t);
    setNewTaskTitle('');
    setActiveModal('todo');
    closeCapture();
  };
  const openCostEdit = (c: CostItem) => {
    setEditingCost(c);
    setNewCostName('');
    setActiveModal('cost');
    closeCapture();
  };
  const openSetupEdit = (item: SetupItem) => {
    setEditingSetup(item);
    setActiveModal('setup');
    closeCapture();
  };

  // "Add '{query}' as…" — mirrors web's handleAddAs: if an item with that
  // exact name already exists (case-insensitive), open THAT item's edit sheet
  // instead of a blank add-sheet, so we never silently duplicate.
  const handleAddAs = (type: 'task' | 'grocery' | 'cost', name: string) => {
    const norm = name.trim().toLowerCase();
    if (type === 'task') {
      const existing = tasks.find((t) => t.title.trim().toLowerCase() === norm);
      setEditingTask(existing);
      setNewTaskTitle(existing ? '' : name);
      setActiveModal('todo');
      closeCapture();
    } else if (type === 'grocery') {
      const existing = groceries.find((g) => g.name.trim().toLowerCase() === norm);
      setEditingGrocery(existing);
      setNewGroceryName(existing ? '' : name);
      setActiveModal('grocery');
      closeCapture();
    } else {
      const existing = costItemsList.find((c) => c.name.trim().toLowerCase() === norm);
      setEditingCost(existing);
      setNewCostName(existing ? '' : name);
      setActiveModal('cost');
      closeCapture();
    }
  };

  const launcherActions: LauncherAction[] = [
    { key: 'todo', label: 'To-do', section: 'household', icon: ListChecks, run: () => openCompose('todo') },
    { key: 'grocery', label: 'Grocery', section: 'groceries', icon: ShoppingCart, run: () => openCompose('grocery') },
    { key: 'cost', label: 'Cost', section: 'costs', icon: Wallet, run: () => openCompose('cost') },
    { key: 'setup', label: 'Setup item', section: 'setup', icon: Home, run: () => { setEditingSetup(undefined); openCompose('setup'); } },
    { key: 'doc', label: 'Doc / Scan', section: 'documents', icon: ScanLine, onlineOnly: true, run: () => openCompose('doc') },
    { key: 'apartment', label: 'Apartment listing', section: 'search', icon: Building2, onlineOnly: true, run: () => navigateTo('/apartment/new') },
    { key: 'checklist', label: 'Viewing checklist', section: 'search', icon: ClipboardCheck, run: () => navigateTo('/checklist') },
    { key: 'recipe', label: 'Recipe', section: 'recipes', icon: ChefHat, run: () => navigateTo('/recipes/new') },
    { key: 'calendar', label: 'Calendar event', section: 'calendar', icon: CalendarDays, run: () => navigateTo('/calendar') },
    { key: 'new-checklist', label: 'Checklist', section: 'checklists', icon: ListTodo, run: () => navigateTo('/checklists/new') },
  ];
  const enabledActions = launcherActions.filter((a) => enabledSectionIds.has(a.section));

  // Add-as chips, gated the same way (only offer types whose section is enabled).
  const addAsChips = [
    { type: 'task' as const, label: 'To-do', section: 'household', icon: ListChecks },
    { type: 'grocery' as const, label: 'Grocery', section: 'groceries', icon: ShoppingCart },
    { type: 'cost' as const, label: 'Cost', section: 'costs', icon: Wallet },
  ].filter((c) => enabledSectionIds.has(c.section));

  return (
    <>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <View className="gap-4 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">Capture</Text>
          <SectionSearchBar value={q} onChange={setQ} placeholder="Search or add…" />

          {q.trim() ? (
            <View className="gap-3">
              {/* HOUP-443: hand the text to the assistant as a quick ask. */}
              {modules.isEnabled('assistant') && isOnline && (
                <Pressable
                  onPress={() => navigateTo(`/assistant/new?kind=quick&ask=${encodeURIComponent(q.trim())}`)}
                  accessibilityRole="button"
                  className="min-h-11 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
                >
                  <Sparkles size={16} color={sectionHueSwatch('assistant', scheme).glyph} />
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                    Ask Rooftap <Text className="text-sm text-muted-foreground">&ldquo;{q.trim()}&rdquo;</Text>
                  </Text>
                </Pressable>
              )}
              {addAsChips.length > 0 && (
                <View>
                  <Text className="mb-1.5 text-xs text-muted-foreground">
                    Add &ldquo;{q.trim()}&rdquo; as…
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {addAsChips.map((c) => (
                      <Pressable
                        key={c.type}
                        onPress={() => handleAddAs(c.type, q.trim())}
                        className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"
                      >
                        <c.icon size={14} color={sectionHueSwatch(c.section, scheme).glyph} />
                        <Text className="text-xs font-medium text-foreground">{c.label}</Text>
                        <Plus size={12} className="text-muted-foreground" />
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              <CaptureSearchResults
                index={searchIndex}
                query={q}
                docsLoading={docsLoading}
                groupId={groupId}
                currentUserId={currentUserId}
                groupMembers={groupMembers}
                memberProfiles={memberProfiles}
                tasks={tasks}
                groceries={groceries}
                costItems={costItemsList}
                setupItems={setupItemsList}
                recipes={recipesList}
                shopperWants={shopperList}
                checklists={checklistsList}
                setupStores={setupStores}
                customAisles={groceryAux.customAisles}
                libraryPriceFor={groceryAux.priceFor}
                writeTask={writeTask}
                patchTask={patchTask}
                softDeleteTask={softDeleteTask}
                patchGrocery={patchGrocery}
                patchCost={patchCost}
                softDeleteCost={softDeleteCost}
                patchSetup={patchSetup}
                softDeleteSetup={softDeleteSetup}
                onEditTask={openTaskEdit}
                onEditGrocery={openGroceryEdit}
                onEditCost={openCostEdit}
                onEditSetup={openSetupEdit}
                onNavigate={navigateTo}
                onHitPress={handleHitClick}
              />
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2.5">
              {enabledActions.map((a) => {
                const disabled = !!a.onlineOnly && !isOnline;
                return (
                  <Pressable
                    key={a.key}
                    onPress={a.run}
                    disabled={disabled}
                    className={cn(
                      'w-[31%] items-center justify-center gap-2 rounded-xl border border-border bg-card px-2 py-4',
                      disabled && 'opacity-40'
                    )}
                  >
                    <LeadingTile sectionId={a.section} Icon={a.icon} size="lg" />
                    <Text className="text-center text-xs font-medium leading-tight text-foreground">{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
        {/* The sheet is its own window (an RN Modal), above the app root's
            ToastHost: the undo pills its rows raise (snooze, delete) land
            here while it's open. */}
        <ToastHost />
      </BottomSheet>

      {groupId && (
        <>
          <HouseholdTaskModal
            key={`todo-${editingTask?.id ?? `new-${newTaskTitle}`}-${activeModal === 'todo'}`}
            open={activeModal === 'todo'}
            task={editingTask}
            groupId={groupId}
            currentUserId={currentUserId}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            defaultTitle={newTaskTitle || undefined}
            onClose={() => { setActiveModal(null); setEditingTask(undefined); setNewTaskTitle(''); }}
            onSave={(task) => { writeTask(task); setActiveModal(null); setEditingTask(undefined); setNewTaskTitle(''); }}
          />
          <GroceryItemFormSheet
            key={`grocery-${editingGrocery?.id ?? `new-${newGroceryName}`}-${activeModal === 'grocery'}`}
            open={activeModal === 'grocery'}
            onOpenChange={(next) => { if (!next) { setActiveModal(null); setEditingGrocery(undefined); setNewGroceryName(''); } }}
            item={editingGrocery}
            groupId={groupId}
            currentUserId={currentUserId}
            defaultName={newGroceryName || undefined}
            aisleUnits={userSettings?.grocery_aisle_units ?? undefined}
            memberProfiles={memberProfiles}
            onSave={(item) => { writeGrocery(item); setActiveModal(null); setEditingGrocery(undefined); setNewGroceryName(''); }}
          />
          <CostModal
            key={`cost-${editingCost?.id ?? `new-${newCostName}`}-${activeModal === 'cost'}`}
            open={activeModal === 'cost'}
            item={editingCost}
            groupId={groupId}
            currentUserId={currentUserId}
            defaultName={newCostName || undefined}
            onClose={() => { setActiveModal(null); setEditingCost(undefined); setNewCostName(''); }}
            onSave={(item) => { writeCost(item); setActiveModal(null); setEditingCost(undefined); setNewCostName(''); }}
          />
          <SetupItemSheet
            key={`setup-${editingSetup?.id ?? 'new'}-${activeModal === 'setup'}`}
            open={activeModal === 'setup'}
            onOpenChange={(next) => { if (!next) { setActiveModal(null); setEditingSetup(undefined); } }}
            item={editingSetup}
            groupId={groupId}
            stores={setupStores}
            onStoreCreated={(store) => setSetupStores((prev) => [...prev, store])}
            onSave={(item) => writeSetup(item)}
            onDelete={(itemId) => softDeleteSetup(itemId)}
          />
          <CaptureFlow
            open={activeModal === 'doc'}
            onClose={() => setActiveModal(null)}
            groupId={groupId}
            groupTags={groupTags}
            onUploaded={() => setActiveModal(null)}
          />
        </>
      )}
    </>
  );
}
