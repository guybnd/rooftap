'use client';

// What a reply changed, under the reply (Guy, Nov 7): each changed item as
// its module's REAL row, read live from the household's stores, so a task
// Rooftap added can be ticked, snoozed or right-clicked for its menu right
// here, the same as on its own page (useLiveRowRenderer, shared with the
// capture sheet's search results). A caption names what happened ("Added to
// Tasks") with Undo for things just added. Past CHANGES_SHOWN items the rest
// fold under "Show all". A change with no row of its own (a meal plan night,
// a calendar event) shows its summary line and opens its module.
// Phone twin: apps/mobile/src/features/assistant/chat-changes.tsx.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { Check, ChevronRight, Undo2 } from 'lucide-react';
import {
  CHANGES_SHOWN,
  SHOWN_ITEMS_FOLD,
  changeCaption,
  changeGroups,
  shownGroups,
  checklists$,
  costItems$,
  groceryItems$,
  householdTasks$,
  listSetupStores,
  recipes$,
  setupItems$,
  shopperWants$,
  syncedGroupId,
  useModules,
  useReconnectSync,
  useStoreHelpers,
  type AssistantChange,
  type AssistantShown,
  type ChangeGroup,
  type Checklist,
  type CostItem,
  type GroceryItem,
  type HouseholdTask,
  type Recipe,
  type SetupItem,
  type SetupStore,
  type ShopperWant,
} from '@homeup/core';
import { cn } from '@/lib/utils';
import { sectionIconFor } from '@/lib/section-icons';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { useGroceryAux } from '@/app/groceries/use-grocery-aux';
import { useLiveRowRenderer, type LiveRowRef } from '@/components/capture/capture-search-results';

const UNDOABLE_ROWS = new Set(['tasks', 'groceries', 'costs', 'setup']);

/** `fresh`: the reply just arrived, so its cards arrive with one turn of the spectrum edge (Hearth §8 "Spectrum once"). */
export function ChatChanges({ changes, shown, fresh = false }: { changes: AssistantChange[] | undefined; shown?: AssistantShown[]; fresh?: boolean }) {
  // What the reply shows (show_items) first: it is the answer; then what it changed.
  const groups = useMemo(() => [...shownGroups(shown), ...changeGroups(changes)], [changes, shown]);
  if (!groups.length) return null;
  return (
    <FreshContext.Provider value={fresh}>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {groups.some((g) => g.rowKind) ? <LiveChanges groups={groups} /> : groups.map((g) => <ChangeCard key={g.key} group={g} renderRow={null} />)}
      </div>
    </FreshContext.Provider>
  );
}

const FreshContext = createContext(false);

/** Opens the stores the rows read only when a reply changed something that has a row. */
function LiveChanges({ groups }: { groups: ChangeGroup[] }) {
  const { group, currentUserId, groupMembers, memberProfiles } = useDataCache();
  const groupId = group?.id ?? '';
  const modules = useModules();
  const router = useRouter();
  const synced = (store$: { collection: string }) => syncedGroupId(store$, groupId || null, modules.enabled);
  const tasks$ = householdTasks$(synced(householdTasks$));
  const groceries$ = groceryItems$(synced(groceryItems$));
  const costs$ = costItems$(synced(costItems$));
  const setup$ = setupItems$(synced(setupItems$));
  const recipesStore$ = recipes$(synced(recipes$));
  const checklistsStore$ = checklists$(synced(checklists$));
  const shopperStore$ = shopperWants$(synced(shopperWants$));
  useReconnectSync(tasks$);
  useReconnectSync(groceries$);
  useReconnectSync(costs$);
  useReconnectSync(setup$);
  useReconnectSync(recipesStore$);
  useReconnectSync(checklistsStore$);
  useReconnectSync(shopperStore$);
  const tasks = use$(() => Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted));
  const groceries = use$(() => Object.values(groceries$.get() ?? {}).filter((g): g is GroceryItem => !!g && !g.deleted));
  const costItems = use$(() => Object.values(costs$.get() ?? {}).filter((c): c is CostItem => !!c && !c.deleted));
  const setupItems = use$(() => Object.values(setup$.get() ?? {}).filter((s): s is SetupItem => !!s && !s.deleted));
  const recipes = use$(() => Object.values(recipesStore$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted));
  const checklists = use$(() => Object.values(checklistsStore$.get() ?? {}).filter((c): c is Checklist => !!c && !c.deleted));
  const shopperWants = use$(() => Object.values(shopperStore$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted));
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: softDeleteTask } = useStoreHelpers(tasks$, currentUserId);
  const { writeRow: writeGrocery, softDeleteRow: softDeleteGrocery } = useStoreHelpers(groceries$, currentUserId);
  const { patchRow: patchCost, softDeleteRow: softDeleteCost } = useStoreHelpers(costs$, currentUserId);
  const { patchRow: patchSetup, softDeleteRow: softDeleteSetup } = useStoreHelpers(setup$, currentUserId);
  const groceryAux = useGroceryAux(groups.some((g) => g.rowKind === 'groceries') ? groupId : null);
  const [setupStores, setSetupStores] = useState<SetupStore[]>([]);
  const wantsSetup = groups.some((g) => g.rowKind === 'setup');
  useEffect(() => {
    if (!groupId || !wantsSetup) return;
    let cancelled = false;
    listSetupStores(createClient(), groupId)
      .then((rows) => {
        if (!cancelled) setSetupStores(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId, wantsSetup]);

  // An item's full editor lives on its own page; the row's quick edits work here.
  const openModule = (path: string) => () => router.push(path);
  const renderRow = useLiveRowRenderer({
    groupId,
    currentUserId,
    groupMembers,
    memberProfiles,
    tasks,
    groceries,
    costItems,
    setupItems,
    recipes,
    checklists,
    shopperWants,
    setupStores,
    onSetupStoreCreated: (store) => setSetupStores((prev) => [...prev, store]),
    customAisles: groceryAux.customAisles,
    libraryPriceFor: groceryAux.priceFor,
    writeTask,
    patchTask,
    softDeleteTask,
    writeGrocery,
    softDeleteGrocery,
    patchCost,
    softDeleteCost,
    patchSetup,
    softDeleteSetup,
    onEditTask: openModule('/tasks'),
    onEditGrocery: openModule('/groceries'),
    onEditCost: openModule('/costs'),
    onEditSetup: openModule('/setup'),
    onBeforeNavigate: () => {},
  });

  // Undo takes back what this reply added, through the same soft delete the pages use.
  const undoAdded = (g: ChangeGroup) => {
    for (const c of g.changes) {
      if (!c.id) continue;
      if (g.rowKind === 'tasks') softDeleteTask(c.id);
      else if (g.rowKind === 'costs') softDeleteCost(c.id);
      else if (g.rowKind === 'setup') softDeleteSetup(c.id);
      else if (g.rowKind === 'groceries') softDeleteGrocery(c.id);
    }
  };

  return (
    <>
      {groups.map((g) => (
        <ChangeCard
          key={g.key}
          group={g}
          renderRow={renderRow}
          onUndo={!g.title && UNDOABLE_ROWS.has(g.rowKind ?? '') && g.changes.every((c) => c.verb === 'added' && c.id) ? () => undoAdded(g) : undefined}
        />
      ))}
    </>
  );
}

/** One module's changes: the caption, the rows (folded past a few) and Undo. */
function ChangeCard({
  group,
  renderRow,
  onUndo,
}: {
  group: ChangeGroup;
  renderRow: ((ref: LiveRowRef) => ReactNode | null) | null;
  onUndo?: () => void;
}) {
  const router = useRouter();
  const fresh = useContext(FreshContext);
  const [all, setAll] = useState(false);
  const [undone, setUndone] = useState(false);
  // A shown group (show_items) lists only the items this person's stores hold, and folds later.
  const listed = group.title && renderRow ? group.changes.filter((c) => c.id && renderRow({ section: group.rowKind!, id: c.id })) : group.changes;
  const shown = all ? listed : listed.slice(0, group.title ? SHOWN_ITEMS_FOLD : CHANGES_SHOWN);
  const hidden = listed.length - shown.length;
  if (group.title && listed.length === 0) return null;
  const Icon = sectionIconFor(group.module);
  const caption = changeCaption(group.changes, group.label);
  const line = (c: AssistantChange, i: number) => {
    const live = renderRow && group.rowKind && c.id ? renderRow({ section: group.rowKind, id: c.id }) : null;
    if (live) return <div key={c.id ?? i}>{live}</div>;
    // No row of its own (or the item is gone): the summary line, opening the module.
    const body = (
      <>
        <LeadingTile sectionId={group.module} Icon={Icon} size="sm" />
        <ListItemContent>
          <ListItemTitle>
            <span className={cn(c.verb === 'removed' && 'text-muted-foreground line-through')}>{c.summary}</span>
          </ListItemTitle>
        </ListItemContent>
        {group.href ? (
          <ListItemTrailing>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </ListItemTrailing>
        ) : null}
      </>
    );
    return group.href ? (
      <ListItem key={c.id ?? i} asChild>
        <button type="button" className="cursor-pointer text-left" onClick={() => router.push(group.href!)}>
          {body}
        </button>
      </ListItem>
    ) : (
      <ListItem key={c.id ?? i}>{body}</ListItem>
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-1">
        {group.title ? (
          <span className="min-w-0 flex-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{group.title}</span>
        ) : (
          <>
            <span className={cn('grid size-4 place-items-center rounded-full text-card', undone ? 'bg-muted-foreground' : 'bg-success')}>
              {undone ? <Undo2 className="size-2.5" /> : <Check className="size-2.5" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">{undone ? 'Undone' : caption}</span>
          </>
        )}
        {onUndo && !undone ? (
          <button
            type="button"
            onClick={() => {
              onUndo();
              setUndone(true);
            }}
            aria-label={`Undo: ${caption}`}
            className="h-8 rounded-lg px-2 text-xs font-medium text-foreground hover:bg-muted"
          >
            Undo
          </button>
        ) : null}
      </div>
      {!undone && (
        <ListGroup className={cn(fresh && 'spectrum-once relative')}>
          {shown.map(line)}
          {hidden > 0 && (
            <ListItem asChild>
              <button type="button" className="cursor-pointer justify-center text-sm font-medium text-foreground" onClick={() => setAll(true)}>
                Show all {listed.length}
              </button>
            </ListItem>
          )}
        </ListGroup>
      )}
    </div>
  );
}
