// What a reply changed, under the reply (Guy, Nov 7): each changed item as
// its module's REAL row, read live from the household's stores, so a task
// Rooftap added can be ticked, snoozed, reassigned or held for its menu right
// here, the same as on its own screen (useLiveRowRenderer, shared with the
// capture sheet's search results). A caption names what happened ("Added to
// Tasks") with Undo for things just added. Past CHANGES_SHOWN items the rest
// fold under "Show all". A change with no row of its own (a meal plan night,
// a calendar event) shows its summary line and opens its module.
// Web twin: apps/web/src/app/assistant/chat-changes.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronRight, EyeOff, PackageCheck, Plus, Undo2 } from 'lucide-react-native';
import { LeadingTile, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, SpectrumOnce, SwipeActions, Text, cn, haptics, toast } from '@homeup/ui';
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
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { sectionIconFor } from '@/lib/section-icons';
import { getBoundSupabaseClient } from '@/lib/supabase-client';
import { useGroceryAux } from '@/features/groceries/use-grocery-aux';
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
  const groups = React.useMemo(() => [...shownGroups(shown), ...changeGroups(changes)], [changes, shown]);
  // Things it offers to add (suggest_items) come last: they are the next step.
  const offers = React.useMemo(() => suggestGroups(shown), [shown]);
  if (!groups.length && !offers.length) return null;
  return (
    <FreshContext.Provider value={fresh}>
      <View className="mt-2.5 gap-2.5">
        {groups.some((g) => g.rowKind) ? <LiveChanges groups={groups} extras={extras} /> : groups.map((g) => <ChangeCard key={g.key} group={g} renderRow={null} action={extras?.action?.(g) ?? null} />)}
        {offers.map((g) => (
          <SuggestCard key={g.key} group={g} />
        ))}
      </View>
    </FreshContext.Provider>
  );
}

const FreshContext = React.createContext(false);

/** Opens the stores the rows read only when a reply changed something that has a row. */
function LiveChanges({ groups, extras }: { groups: ChangeGroup[]; extras?: ChatChangesExtras }) {
  const { group, currentUserId, groupMembers, memberProfiles } = useDataCache();
  const groupId = group?.id ?? null;
  const modules = useModules();
  const openRoute = useOpenRoute();
  const synced = (store$: { collection: string }) => syncedGroupId(store$, groupId, modules.enabled);
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
  const { patchRow: patchGrocery } = useStoreHelpers(groceries$, currentUserId);
  const { patchRow: patchCost, softDeleteRow: softDeleteCost } = useStoreHelpers(costs$, currentUserId);
  const { patchRow: patchSetup, softDeleteRow: softDeleteSetup } = useStoreHelpers(setup$, currentUserId);
  const groceryAux = useGroceryAux(groups.some((g) => g.rowKind === 'groceries') ? groupId : null);
  const [setupStores, setSetupStores] = React.useState<SetupStore[]>([]);
  const wantsSetup = groups.some((g) => g.rowKind === 'setup');
  React.useEffect(() => {
    const supabase = getBoundSupabaseClient();
    if (!groupId || !wantsSetup || !supabase) return;
    let cancelled = false;
    listSetupStores(supabase, groupId)
      .then((rows) => !cancelled && setSetupStores(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId, wantsSetup]);

  // An item's full editor lives on its own screen; the row's quick edits work here.
  const openModule = (path: string) => () => openRoute(path);
  const refs = React.useMemo<LiveRowRef[]>(
    () => groups.flatMap((g) => (g.rowKind ? g.changes.filter((c) => c.id).map((c) => ({ section: g.rowKind!, id: c.id! })) : [])),
    [groups]
  );
  const renderRow = useLiveRowRenderer(
    {
      groupId,
      currentUserId,
      groupMembers,
      memberProfiles,
      tasks,
      groceries,
      costItems,
      setupItems,
      recipes,
      shopperWants,
      checklists,
      setupStores,
      customAisles: groceryAux.customAisles,
      libraryPriceFor: groceryAux.priceFor,
      writeTask,
      patchTask,
      softDeleteTask,
      patchGrocery,
      patchCost,
      softDeleteCost,
      patchSetup,
      softDeleteSetup,
      onEditTask: openModule('/tasks'),
      onEditGrocery: openModule('/groceries'),
      onEditCost: openModule('/costs'),
      onEditSetup: openModule('/setup'),
      onNavigate: openRoute,
    },
    refs
  );

  // Undo takes back what this reply added, through the same soft delete the screens use.
  const undoAdded = (g: ChangeGroup) => {
    for (const c of g.changes) {
      if (!c.id) continue;
      if (g.rowKind === 'tasks') softDeleteTask(c.id);
      else if (g.rowKind === 'costs') softDeleteCost(c.id);
      else if (g.rowKind === 'setup') softDeleteSetup(c.id);
      else if (g.rowKind === 'groceries') patchGrocery(c.id, { deleted: true });
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
  renderRow: ((ref: LiveRowRef) => React.ReactNode | null) | null;
  action?: GroupAction | null;
  rowExtra?: (id: string) => Partial<LiveRowRef>;
  onUndo?: () => void;
}) {
  const openRoute = useOpenRoute();
  const fresh = React.useContext(FreshContext);
  const [all, setAll] = React.useState(false);
  const [undone, setUndone] = React.useState(false);
  // A shown group (show_items) lists only the items this person's stores hold, and folds later.
  const listed = group.title && renderRow ? group.changes.filter((c) => c.id && renderRow({ section: group.rowKind!, id: c.id })) : group.changes;
  const shown = all ? listed : listed.slice(0, group.title ? SHOWN_ITEMS_FOLD : CHANGES_SHOWN);
  const hidden = listed.length - shown.length;
  if (group.title && listed.length === 0) return null;
  const Icon = sectionIconFor(group.module);
  const line = (c: AssistantChange, i: number) => {
    const live = renderRow && group.rowKind && c.id ? renderRow({ ...rowExtra?.(c.id), section: group.rowKind, id: c.id }) : null;
    if (live) return <React.Fragment key={c.id ?? i}>{live}</React.Fragment>;
    // No row of its own (or the item is gone): the summary line, opening the module.
    return (
      <ListItem
        key={c.id ?? i}
        className="items-center gap-3"
        onPress={group.href ? () => openRoute(group.href!) : undefined}
        accessibilityRole={group.href ? 'link' : undefined}
      >
        <LeadingTile sectionId={group.module} Icon={Icon} size="sm" />
        <ListItemContent>
          <ListItemTitle numberOfLines={2} className={cn(c.verb === 'removed' && 'text-muted-foreground line-through')}>
            {c.summary}
          </ListItemTitle>
        </ListItemContent>
        {group.href ? (
          <ListItemTrailing className="mt-0">
            <ChevronRight size={16} className="text-muted-foreground" />
          </ListItemTrailing>
        ) : null}
      </ListItem>
    );
  };
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1.5 px-1">
        {group.title ? (
          <Text className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">{group.title}</Text>
        ) : (
          <>
            <View className={cn('size-4 items-center justify-center rounded-full', undone ? 'bg-muted-foreground' : 'bg-success')}>
              {undone ? <Undo2 size={9} className="text-card" /> : <Check size={10} strokeWidth={3} className="text-card" />}
            </View>
            <Text className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              {undone ? 'Undone' : changeCaption(group.changes, group.label)}
            </Text>
          </>
        )}
        {action && !onUndo ? (
          <Pressable onPress={action.run} accessibilityRole="button" hitSlop={8} className="h-8 justify-center rounded-lg px-2 active:bg-muted">
            <Text className="text-xs font-semibold text-primary">{action.label}</Text>
          </Pressable>
        ) : null}
        {onUndo && !undone ? (
          <Pressable
            onPress={() => {
              haptics.remove();
              onUndo();
              setUndone(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Undo: ${changeCaption(group.changes, group.label)}`}
            hitSlop={8}
            className="h-8 justify-center rounded-lg px-2 active:bg-muted"
          >
            <Text className="text-xs font-medium text-foreground">Undo</Text>
          </Pressable>
        ) : null}
      </View>
      {!undone && (
        <View>
          <ListGroup>
            {shown.map(line)}
            {hidden > 0 && (
              <ListItem className="items-center justify-center" onPress={() => setAll(true)} accessibilityRole="button">
                <Text className="text-sm font-medium text-foreground">Show all {listed.length}</Text>
              </ListItem>
            )}
          </ListGroup>
          {fresh && <SpectrumOnce radius={24} />}
        </View>
      )}
    </View>
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
  const add = () => {
    haptics.commit();
    onAdd();
  };
  return (
    <SwipeActions
      onSwipeRight={add}
      onSwipeLeft={
        dismissLabel
          ? () => {
              haptics.remove();
              onDismiss();
            }
          : undefined
      }
      right={{ bg: 'bg-success/15', activeBg: 'bg-success', icon: <Plus size={18} className="text-success" />, label: 'Add' }}
      left={dismissLabel ? { bg: 'bg-primary/15', activeBg: 'bg-primary', icon: dismissLabel === 'Have it' ? <PackageCheck size={18} className="text-primary" /> : <EyeOff size={18} className="text-primary" />, label: dismissLabel } : undefined}
    >
      <ListItem className="items-center gap-3">
        <Pressable
          onPress={add}
          accessibilityRole="button"
          accessibilityLabel={`Add ${title}`}
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-dashed border-primary/60 active:bg-primary/10"
        >
          <Plus size={16} className="text-primary" />
        </Pressable>
        <ListItemContent>
          <ListItemTitle numberOfLines={1}>{title}</ListItemTitle>
          {meta ? (
            <ListItemMeta>
              <Text className="text-caption text-muted-foreground">{meta}</Text>
            </ListItemMeta>
          ) : null}
        </ListItemContent>
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
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(new Set());
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
    if (n > 0) toast.success(n === 1 ? `Added ${list[0].name} to the list` : `Added ${n} to the list`);
  };
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1.5 px-1">
        <Text className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">{group.title}</Text>
        {rows.length > 1 ? (
          <Pressable
            onPress={() => {
              haptics.commit();
              add(rows);
            }}
            accessibilityRole="button"
            hitSlop={8}
            className="h-8 justify-center rounded-lg px-2 active:bg-muted"
          >
            <Text className="text-xs font-semibold text-primary">Add all</Text>
          </Pressable>
        ) : null}
      </View>
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
    </View>
  );
}
