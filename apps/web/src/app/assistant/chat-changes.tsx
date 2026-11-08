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
import { Check, ChevronRight, EyeOff, PackageCheck, Plus, Undo2 } from 'lucide-react';
import {
  CHANGES_SHOWN,
  SHOWN_ITEMS_FOLD,
  changeCaption,
  changeGroups,
  shownGroups,
  suggestGroups,
  addSuggestedGrocery,
  suggestionNeeded,
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
  type SuggestGroup,
} from '@homeup/core';
import { cn } from '@/lib/utils';
import { sectionIconFor } from '@/lib/section-icons';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { SwipeActions } from '@/components/ui/swipe-actions';
import { toast } from 'sonner';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { useGroceryAux } from '@/app/groceries/use-grocery-aux';
import { useLiveRowRenderer, type LiveRowRef } from '@/components/capture/capture-search-results';
import { useRows } from '@homeup/core';

const UNDOABLE_ROWS = new Set(['tasks', 'groceries', 'costs', 'setup']);

/** `fresh`: the reply just arrived, so its cards arrive with one turn of the spectrum edge (Hearth §8 "Spectrum once"). */
/** A titled group's header link ("Re-add all"), for the helper's brief. */
export interface GroupAction {
  label: string;
  run: () => void;
}

/**
 * `action`: a titled group's header link. `rowExtra`: what one row adds to
 * its module's own row (the brief's "Not now"). Both only for the brief.
 */
export interface ChatChangesExtras {
  action?: (group: ChangeGroup) => GroupAction | null;
  rowExtra?: (group: ChangeGroup, id: string) => Partial<LiveRowRef>;
}

export function ChatChanges({
  changes,
  shown,
  fresh = false,
  extras,
}: {
  changes: AssistantChange[] | undefined;
  shown?: AssistantShown[];
  fresh?: boolean;
  extras?: ChatChangesExtras;
}) {
  // What the reply shows (show_items) first: it is the answer; then what it changed.
  const groups = useMemo(() => [...shownGroups(shown), ...changeGroups(changes)], [changes, shown]);
  // Things it offers to add (suggest_items) come last: they are the next step.
  const offers = useMemo(() => suggestGroups(shown), [shown]);
  if (!groups.length && !offers.length) return null;
  return (
    <FreshContext.Provider value={fresh}>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {groups.some((g) => g.rowKind) ? <LiveChanges groups={groups} extras={extras} /> : groups.map((g) => <ChangeCard key={g.key} group={g} renderRow={null} action={extras?.action?.(g) ?? null} />)}
        {offers.map((g) => (
          <SuggestCard key={g.key} group={g} />
        ))}
      </div>
    </FreshContext.Provider>
  );
}

const FreshContext = createContext(false);

/** Opens the stores the rows read only when a reply changed something that has a row. */
function LiveChanges({ groups, extras }: { groups: ChangeGroup[]; extras?: ChatChangesExtras }) {
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
  const tasks = useRows(tasks$);
  const groceries = useRows(groceries$);
  const costItems = useRows(costs$);
  const setupItems = useRows(setup$);
  const recipes = useRows(recipesStore$);
  const checklists = useRows(checklistsStore$);
  const shopperWants = useRows(shopperStore$);
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
          action={extras?.action?.(g) ?? null}
          rowExtra={extras?.rowExtra ? (id) => extras.rowExtra!(g, id) : undefined}
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
  action,
  rowExtra,
  onUndo,
}: {
  group: ChangeGroup;
  renderRow: ((ref: LiveRowRef) => ReactNode | null) | null;
  action?: GroupAction | null;
  rowExtra?: (id: string) => Partial<LiveRowRef>;
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
    const live = renderRow && group.rowKind && c.id ? renderRow({ ...rowExtra?.(c.id), section: group.rowKind, id: c.id }) : null;
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
        {action && !onUndo ? (
          <button
            type="button"
            onClick={action.run}
            className="h-8 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-muted"
          >
            {action.label}
          </button>
        ) : null}
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

/**
 * A suggested row (something not there yet, such as a missing ingredient):
 * the + or a swipe right adds it, a swipe left dismisses it as the section
 * says ("Have it", "Not needed"). The helper's brief and a reply's
 * suggest_items both use it; rows that already exist are their module's own
 * row instead.
 */
export function SuggestLine({
  title,
  meta,
  dismissLabel,
  onAdd,
  onDismiss,
}: {
  title: string;
  meta?: string | null;
  dismissLabel: string | null;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <SwipeActions
      onSwipeRight={onAdd}
      onSwipeLeft={dismissLabel ? onDismiss : undefined}
      right={{ bg: 'bg-success/70', activeBg: 'bg-success', icon: <Plus className="h-5 w-5 text-white" />, label: 'Add' }}
      left={dismissLabel ? { bg: 'bg-primary/70', activeBg: 'bg-primary', icon: dismissLabel === 'Have it' ? <PackageCheck className="h-5 w-5 text-white" /> : <EyeOff className="h-5 w-5 text-white" />, label: dismissLabel } : undefined}
    >
      <ListItem className="group">
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add ${title}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-primary/60 text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" />
        </button>
        <ListItemContent>
          <ListItemTitle>
            <span className="text-foreground">{title}</span>
          </ListItemTitle>
          {meta && <ListItemMeta>{meta}</ListItemMeta>}
        </ListItemContent>
        {dismissLabel && (
          <ListItemTrailing>
            {/* With a mouse there is no swipe: the dismiss shows on hover. */}
            <button
              type="button"
              onClick={onDismiss}
              className="hidden h-8 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:inline-flex group-hover:inline-flex md:items-center"
            >
              {dismissLabel}
            </button>
          </ListItemTrailing>
        )}
      </ListItem>
    </SwipeActions>
  );
}


/**
 * A reply's offered groceries (suggest_items): each a tap or a swipe from the
 * list, or swiped away as not needed. A row goes once its item is on the list.
 */
function SuggestCard({ group }: { group: SuggestGroup }) {
  const { group: household, currentUserId } = useDataCache();
  const modules = useModules();
  const groupId = household?.id ?? null;
  const items$ = groceryItems$(syncedGroupId(groceryItems$, groupId, modules.enabled));
  useReconnectSync(items$);
  const items = useRows(items$);
  const { writeRow, patchRow } = useStoreHelpers(items$, currentUserId);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const rows = group.items.filter((it) => !dismissed.has(it.name) && !suggestionNeeded(it.name, items));
  if (!groupId || !modules.isEnabled('groceries') || rows.length === 0) return null;
  const add = (list: typeof rows) => {
    let n = 0;
    for (const it of list) {
      const change = addSuggestedGrocery({ groupId, suggestion: it, items, createdBy: currentUserId ?? null });
      if (!change) continue;
      if ('write' in change) writeRow(change.write);
      else patchRow(change.patch.id, change.patch.changes);
      n++;
    }
    if (n > 0) toast(n === 1 ? `Added ${list[0].name} to the list` : `Added ${n} to the list`);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <span className="min-w-0 flex-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{group.title}</span>
        {rows.length > 1 && (
          <button type="button" onClick={() => add(rows)} className="h-8 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-muted">
            Add all
          </button>
        )}
      </div>
      <ListGroup>
        {rows.map((it) => (
          <SuggestLine
            key={it.name}
            title={it.name}
            meta={[it.quantity ? `${it.quantity}${it.unit ? ` ${it.unit}` : ''}` : null, it.note].filter(Boolean).join(', ') || null}
            dismissLabel="Not needed"
            onAdd={() => add([it])}
            onDismiss={() => setDismissed((d) => new Set(d).add(it.name))}
          />
        ))}
      </ListGroup>
    </div>
  );
}
