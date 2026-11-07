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
import { use$ } from '@legendapp/state/react';
import { Check, ChevronRight, Undo2 } from 'lucide-react-native';
import { LeadingTile, ListGroup, ListItem, ListItemContent, ListItemTitle, ListItemTrailing, Text, cn, haptics } from '@homeup/ui';
import {
  CHANGES_SHOWN,
  changeCaption,
  changeGroups,
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
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { sectionIconFor } from '@/lib/section-icons';
import { getBoundSupabaseClient } from '@/lib/supabase-client';
import { useGroceryAux } from '@/features/groceries/use-grocery-aux';
import { useLiveRowRenderer, type LiveRowRef } from '@/components/capture/capture-search-results';

const UNDOABLE_ROWS = new Set(['tasks', 'groceries', 'costs', 'setup']);

export function ChatChanges({ changes }: { changes: AssistantChange[] | undefined }) {
  const groups = React.useMemo(() => changeGroups(changes), [changes]);
  if (!groups.length) return null;
  return (
    <View className="mt-2.5 gap-2.5">
      {groups.some((g) => g.rowKind) ? <LiveChanges groups={groups} /> : groups.map((g) => <ChangeCard key={g.module} group={g} renderRow={null} />)}
    </View>
  );
}

/** Opens the stores the rows read only when a reply changed something that has a row. */
function LiveChanges({ groups }: { groups: ChangeGroup[] }) {
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
  const tasks = use$(() => Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted));
  const groceries = use$(() => Object.values(groceries$.get() ?? {}).filter((g): g is GroceryItem => !!g && !g.deleted));
  const costItems = use$(() => Object.values(costs$.get() ?? {}).filter((c): c is CostItem => !!c && !c.deleted));
  const setupItems = use$(() => Object.values(setup$.get() ?? {}).filter((s): s is SetupItem => !!s && !s.deleted));
  const recipes = use$(() => Object.values(recipesStore$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted));
  const checklists = use$(() => Object.values(checklistsStore$.get() ?? {}).filter((c): c is Checklist => !!c && !c.deleted));
  const shopperWants = use$(() => Object.values(shopperStore$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted));
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
          key={g.module}
          group={g}
          renderRow={renderRow}
          onUndo={UNDOABLE_ROWS.has(g.rowKind ?? '') && g.changes.every((c) => c.verb === 'added' && c.id) ? () => undoAdded(g) : undefined}
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
  renderRow: ((ref: LiveRowRef) => React.ReactNode | null) | null;
  onUndo?: () => void;
}) {
  const openRoute = useOpenRoute();
  const [all, setAll] = React.useState(false);
  const [undone, setUndone] = React.useState(false);
  const shown = all ? group.changes : group.changes.slice(0, CHANGES_SHOWN);
  const hidden = group.changes.length - shown.length;
  const Icon = sectionIconFor(group.module);
  const line = (c: AssistantChange, i: number) => {
    const live = renderRow && group.rowKind && c.id ? renderRow({ section: group.rowKind, id: c.id }) : null;
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
        <View className={cn('size-4 items-center justify-center rounded-full', undone ? 'bg-muted-foreground' : 'bg-success')}>
          {undone ? <Undo2 size={9} className="text-card" /> : <Check size={10} strokeWidth={3} className="text-card" />}
        </View>
        <Text className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
          {undone ? 'Undone' : changeCaption(group.changes, group.label)}
        </Text>
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
        <ListGroup>
          {shown.map(line)}
          {hidden > 0 && (
            <ListItem className="items-center justify-center" onPress={() => setAll(true)} accessibilityRole="button">
              <Text className="text-sm font-medium text-foreground">Show all {group.changes.length}</Text>
            </ListItem>
          )}
        </ListGroup>
      )}
    </View>
  );
}
