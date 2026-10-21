// The capture sheet's search results, rendered as each section's REAL line
// item (Guy, Hearth v2 polish): a found to-do is the Tasks screen's TaskRow
// (swipe right to finish, left to snooze, tick, hold for the quick menu,
// inline title edit), a grocery is the grocery card, a cost the cost row, a
// setup item the setup card, a checklist and a recipe their list rows. Each
// row is wired to the same store writes its own screen makes, through the
// capture sheet's store helpers. Hits with no row of their own (a viewing,
// an apartment, a document, a viewing-checklist item) stay plain rows with a
// chevron (GlobalSearchResults' fallback). Web twin:
// apps/web/src/components/capture/capture-search-results.tsx.
import * as React from 'react';
import { use$ } from '@legendapp/state/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { haptics, toast } from '@homeup/ui';
import {
  applyTaskCompletion,
  checklistItems$,
  deleteCostReminders,
  recipeIngredients$,
  syncedGroupId,
  taskFieldPatch,
  useEntityCommentCounts,
  useModules,
  useHouseholdCurrency,
  summarizeWants,
  todayISO,
  useReconnectSync,
  type Checklist,
  type ChecklistTaskItem,
  type CostItem,
  type GroceryCustomAisle,
  type GroceryItem,
  type GroupMember,
  type HouseholdTask,
  type Recipe,
  type ShopperWant,
  type RecipeIngredient,
  type SetupItem,
  type SetupStore,
  type TaskSnooze,
  dialog,
} from '@homeup/core';
import { useFuzzySearch } from '@homeup/core/src/hooks/use-fuzzy-search';
import type { GlobalHit } from '@homeup/core/src/hooks/use-global-search-index';
import { GlobalSearchResults, GLOBAL_SEARCH_RESULT_LIMIT } from '@/components/search/global-search-results';
import { TaskRow } from '@/features/tasks/task-row';
import { useTaskSnoozeUndo } from '@/features/tasks/use-task-snooze-undo';
import { GroceryItemCard } from '@/features/groceries/grocery-item-card';
import { CostRow } from '@/features/costs/cost-card';
import { SetupItemCard } from '@/features/setup/setup-item-card';
import { ChecklistRow } from '@/features/checklists/checklist-row';
import { RecipeRow } from '@/features/recipes/recipe-row';
import { WantRow } from '@/features/shopper/want-row';
import { getBoundSupabaseClient } from '@/lib/supabase-client';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import { randomUUID } from '@/lib/uuid';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
type Patch<T> = (id: string, patch: Partial<T>) => void;

export interface CaptureSearchResultsProps {
  /** The unfiltered cross-section index (core's useGlobalSearchIndex). */
  index: GlobalHit[];
  query: string;
  docsLoading?: boolean;
  groupId: string | null;
  currentUserId: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  // Records the hits point at (looked up by id: a GlobalHit carries no row).
  tasks: HouseholdTask[];
  groceries: GroceryItem[];
  costItems: CostItem[];
  setupItems: SetupItem[];
  recipes: Recipe[];
  /** Shopper items (HOUP-434); empty while the module is off. */
  shopperWants?: ShopperWant[];
  checklists: Checklist[];
  setupStores: SetupStore[];
  customAisles?: GroceryCustomAisle[];
  libraryPriceFor?: (name: string) => number | null;
  // The capture sheet's store writes (the same helpers each screen binds).
  writeTask: (task: HouseholdTask) => void;
  patchTask: Patch<HouseholdTask>;
  softDeleteTask: (id: string) => void;
  patchGrocery: Patch<GroceryItem>;
  patchCost: Patch<CostItem>;
  softDeleteCost: (id: string) => void;
  patchSetup: Patch<SetupItem>;
  softDeleteSetup: (id: string) => void;
  // Editors the capture sheet owns (each closes the sheet and opens a form).
  onEditTask: (task: HouseholdTask) => void;
  onEditGrocery: (item: GroceryItem) => void;
  onEditCost: (item: CostItem) => void;
  onEditSetup: (item: SetupItem) => void;
  /** Close the sheet and route (checklist and recipe rows, which open their detail). */
  onNavigate: (href: string) => void;
  /** A plain row's tap (core's resolveGlobalHitAction decides nav vs sheet). */
  onHitPress: (hit: GlobalHit) => void;
}

export function CaptureSearchResults({
  index,
  query,
  docsLoading,
  groupId,
  currentUserId,
  groupMembers,
  memberProfiles,
  tasks,
  groceries,
  costItems,
  setupItems,
  recipes,
  shopperWants = [],
  checklists,
  setupStores,
  customAisles,
  libraryPriceFor,
  writeTask,
  patchTask,
  softDeleteTask,
  patchGrocery,
  patchCost,
  softDeleteCost,
  patchSetup,
  softDeleteSetup,
  onEditTask,
  onEditGrocery,
  onEditCost,
  onEditSetup,
  onNavigate,
  onHitPress,
}: CaptureSearchResultsProps) {
  const modules = useModules();
  const currency = useHouseholdCurrency();
  const hits = useFuzzySearch(index, query, ['title', 'subtitle', 'keywords']).slice(0, GLOBAL_SEARCH_RESULT_LIMIT);

  // The bound (non-throwing) client: this only mounts while searching, long
  // after cold boot binds one, and every query below is skipped on no ids.
  const supabase = getBoundSupabaseClient() as SupabaseClient;

  // Checklist items back both a task's "Checklist N/M" chip and a checklist
  // hit's meter; recipe ingredients back a recipe hit's have/need line.
  // Store singletons, so this is the Tasks/Checklists/Recipes screens' cache.
  const checklistItemsStore$ = checklistItems$(syncedGroupId(checklistItems$, groupId, modules.enabled));
  const ingredientsStore$ = recipeIngredients$(syncedGroupId(recipeIngredients$, groupId, modules.enabled));
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(ingredientsStore$);
  const checklistTaskItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistTaskItem => !!i && !i.deleted)
  );
  const ingredients = use$(() =>
    Object.values(ingredientsStore$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted)
  );

  const checklistsById = React.useMemo(() => {
    const map: Record<string, Checklist> = {};
    for (const cl of checklists) map[cl.id] = cl;
    return map;
  }, [checklists]);
  const checklistItemsByChecklistId = React.useMemo(() => {
    const map: Record<string, ChecklistTaskItem[]> = {};
    for (const item of checklistTaskItems) (map[item.checklist_id] ??= []).push(item);
    for (const list of Object.values(map)) list.sort((a, b) => a.order - b.order);
    return map;
  }, [checklistTaskItems]);

  // One batched comment-count query per row type, scoped to the hits shown
  // (mirrors the Tasks and Setup screens' batched counts).
  const shownTaskIds = hits.filter((h) => h.section === 'tasks').map((h) => h.id);
  const shownSetupIds = hits.filter((h) => h.section === 'setup').map((h) => h.id);
  const taskCommentCounts = useEntityCommentCounts(supabase, 'household_task_comments', 'household_task_id', shownTaskIds);
  const setupCommentCounts = useEntityCommentCounts(supabase, 'setup_item_comments', 'setup_item_id', shownSetupIds);

  // ── Tasks: the Tasks screen's handlers (apps/mobile/src/app/(tabs)/tasks) ──
  const snoozeWithUndo = useTaskSnoozeUndo(patchTask);
  const patchTaskRef = React.useRef(patchTask);
  patchTaskRef.current = patchTask;
  const taskDeleteUndo = React.useMemo(
    () =>
      createUndoToastPresenter<HouseholdTask>({
        message: (count) => (count === 1 ? 'Task deleted' : `${count} tasks deleted`),
        restore: (task) => patchTaskRef.current(task.id, { deleted: false }),
      }),
    []
  );
  const toggleTask = (task: HouseholdTask) => {
    const { update, createNextOccurrence } = applyTaskCompletion(task, !task.done, { nextId: randomUUID() });
    patchTask(task.id, update);
    if (createNextOccurrence) writeTask(createNextOccurrence);
  };

  // ── Costs: the Costs screen's delete-with-undo + reminder cleanup ────────
  const deleteCost = (item: CostItem) => {
    haptics.remove();
    softDeleteCost(item.id);
    toast.message(`Removed "${item.name}"`, {
      duration: 5000,
      action: { label: 'Undo', onPress: () => patchCost(item.id, { deleted: false }) },
    });
    if (supabase) void deleteCostReminders(item, supabase);
  };

  // ── Setup: the Setup screen's status change and confirm-gated delete ────
  const setSetupStatus = (item: SetupItem, status: SetupItem['status']) => {
    if (status === item.status) return;
    patchSetup(item.id, { status });
    if (status === 'installed') {
      const room = item.room || 'Other';
      const siblings = setupItems.filter((i) => i.id !== item.id && (i.room || 'Other') === room);
      if (siblings.length > 0 && siblings.every((i) => i.status === 'installed')) haptics.success();
    }
  };
  const deleteSetup = (item: SetupItem) => {
    dialog.alert(`Delete "${item.name}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          softDeleteSetup(item.id);
        },
      },
    ]);
  };

  const renderRow = (hit: GlobalHit): React.ReactNode | null => {
    switch (hit.section) {
      case 'tasks': {
        const task = tasks.find((t) => t.id === hit.id);
        if (!task) return null;
        return (
          <TaskRow
            task={task}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            currentUserId={currentUserId}
            onToggleComplete={toggleTask}
            onEdit={onEditTask}
            onDelete={(t) => {
              softDeleteTask(t.id);
              taskDeleteUndo.addAndShow(t);
            }}
            onSnooze={(t, dur: TaskSnooze) => snoozeWithUndo(t, dur)}
            onReassign={(t, userId) => patchTask(t.id, { assigned_to: userId })}
            onPriorityChange={(t, priority) => patchTask(t.id, { priority })}
            onRecurrenceChange={(t, days) => patchTask(t.id, { recurrence_days: days })}
            onFieldChange={(t, field, value) => {
              const patch = taskFieldPatch(t, field, value);
              if (patch) patchTask(t.id, patch);
            }}
            checklistsById={checklistsById}
            checklistItemsByChecklistId={checklistItemsByChecklistId}
            supabase={supabase}
            commentCount={taskCommentCounts.counts[task.id] ?? 0}
            onCommentsChanged={taskCommentCounts.refresh}
          />
        );
      }
      case 'groceries': {
        const grocery = groceries.find((g) => g.id === hit.id);
        if (!grocery) return null;
        return (
          <GroceryItemCard
            item={grocery}
            customAisles={customAisles}
            libraryPriceCents={libraryPriceFor?.(grocery.name) ?? null}
            memberProfiles={memberProfiles}
            onPatch={patchGrocery}
            onEdit={onEditGrocery}
          />
        );
      }
      case 'costs': {
        const cost = costItems.find((c) => c.id === hit.id);
        if (!cost || !groupId) return null;
        return (
          <CostRow
            item={cost}
            groupId={groupId}
            currentUserId={currentUserId}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            onEdit={onEditCost}
            onDelete={deleteCost}
            onUpdate={(updated) => patchCost(updated.id, updated)}
            onAssign={(id, userId) => patchCost(id, { assigned_to: userId || null })}
          />
        );
      }
      case 'setup': {
        const item = setupItems.find((s) => s.id === hit.id);
        if (!item) return null;
        return (
          <SetupItemCard
            item={item}
            stores={setupStores}
            onStatusChange={setSetupStatus}
            onPatch={patchSetup}
            onDelete={() => deleteSetup(item)}
            onEdit={onEditSetup}
            commentCount={setupCommentCounts.counts[item.id] ?? 0}
            onCommentsChanged={setupCommentCounts.refresh}
            supabase={supabase}
            currentUserId={currentUserId}
            memberProfiles={memberProfiles}
          />
        );
      }
      case 'checklists': {
        const list = checklistsById[hit.id];
        if (!list) return null;
        return (
          <ChecklistRow
            list={list}
            items={checklistItemsByChecklistId[list.id] ?? []}
            onPress={() => onNavigate(`/checklists/${list.id}`)}
          />
        );
      }
      case 'recipes': {
        const recipe = recipes.find((r) => r.id === hit.id);
        if (!recipe) return null;
        return (
          <RecipeRow
            recipe={recipe}
            ingredients={ingredients.filter((i) => i.recipe_id === recipe.id)}
            groceryItems={groceries}
            groceriesLinked={modules.feature('recipes.groceries')}
            onPress={() => onNavigate(`/recipes/${recipe.id}`)}
          />
        );
      }
      case 'shopper': {
        const want = shopperWants.find((w) => w.id === hit.id);
        if (!want) return null;
        return (
          <WantRow
            row={summarizeWants([want], [], todayISO())[0]}
            currency={currency}
            onPress={() => onNavigate(`/shopper/${want.id}`)}
          />
        );
      }
      default:
        return null;
    }
  };

  return (
    <GlobalSearchResults hits={hits} query={query} docsLoading={docsLoading} renderRow={renderRow} onHitPress={onHitPress} />
  );
}
