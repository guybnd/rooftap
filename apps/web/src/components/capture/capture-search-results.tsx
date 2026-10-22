"use client";

// The capture sheet's search results, rendered as each section's REAL line
// item (Guy, Hearth v2 polish): a found to-do is the Tasks page's TaskRow
// (swipe right to finish, left to snooze, tick, hold or right-click for the
// quick menu, inline title/date edit), a grocery the grocery card, a cost the
// cost card, a setup item the setup card, a checklist and a recipe their list
// rows. Each row is wired to the same store writes its own page makes,
// through the capture sheet's store helpers. Hits with no row of their own
// (a viewing, an apartment, a document, a viewing-checklist item) stay plain
// rows: the section's leading tile, the title, one meta line and a chevron.
// Hits group under a micro label per section, one bordered list each (H4).
// Native twin: apps/mobile/src/components/capture/capture-search-results.tsx.

import { useMemo, type ReactNode } from "react";
import { use$ } from "@legendapp/state/react";
import { ChevronRight } from "lucide-react";
import {
  applyTaskCompletion,
  checklistItems$,
  deleteCostReminders,
  recipeIngredients$,
  syncedGroupId,
  todayISO,
  summarizeWants,
  useHouseholdCurrency,
  useModules,
  useReconnectSync,
  type Checklist,
  type ShopperWant,
  type ChecklistTaskItem,
  type CostItem,
  type GroceryCustomAisle,
  type GroceryItem,
  type GroupMember,
  type HouseholdTask,
  type Recipe,
  type RecipeIngredient,
  type SetupItem,
  type SetupStore,
  type TaskSnooze,
} from "@homeup/core";
import { dialog } from "@homeup/core";
import { GLOBAL_HIT_SECTION_ID, resolveGlobalHitAction, type GlobalHit } from "@/hooks/use-global-search-index";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { HOUSEHOLD_TASKS_CHANGED_EVENT } from "@/hooks/use-overdue-task-count";
import { createClient } from "@/lib/supabase/client";
import { sectionIconFor } from "@/lib/section-icons";
import { toastUndoDelete } from "@/lib/undo-toast";
import { LeadingTile } from "@/components/ui/leading-tile";
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from "@/components/ui/list-item";
import { TaskRow } from "@/app/tasks/task-row";
import { useTaskSnoozeUndo } from "@/app/tasks/use-task-snooze-undo";
import { GroceryItemCardStandalone } from "@/app/groceries/grocery-item-card";
import { CostCard } from "@/app/costs/cost-card";
import { SetupItemCard } from "@/app/setup/setup-item-card";
import { ChecklistRow } from "@/app/checklists/checklist-row";
import { RecipeRow } from "@/app/recipes/recipe-row";
import { WantRow } from "@/app/shopper/want-row";

/** Results cap across all sections (FLUX-176: the sheet and keyboard always fit). */
const RESULT_LIMIT = 3;

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
type Patch<T> = (id: string, patch: Partial<T>) => void;

export interface CaptureSearchResultsProps {
  /** The unfiltered cross-section index (core's useGlobalSearchIndex). */
  index: GlobalHit[];
  query: string;
  docsLoading?: boolean;
  groupId: string;
  currentUserId: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  // Records the hits point at (looked up by id: a GlobalHit carries no row).
  tasks: HouseholdTask[];
  groceries: GroceryItem[];
  costItems: CostItem[];
  setupItems: SetupItem[];
  recipes: Recipe[];
  checklists: Checklist[];
  shopperWants?: ShopperWant[];
  setupStores: SetupStore[];
  onSetupStoreCreated: (store: SetupStore) => void;
  customAisles?: GroceryCustomAisle[];
  libraryPriceFor?: (name: string) => number | null;
  // The capture sheet's store writes (the same helpers each page binds).
  writeTask: (task: HouseholdTask) => void;
  patchTask: Patch<HouseholdTask>;
  softDeleteTask: (id: string) => void;
  writeGrocery: (item: GroceryItem) => void;
  softDeleteGrocery: (id: string) => void;
  patchCost: Patch<CostItem>;
  softDeleteCost: (id: string) => void;
  patchSetup: Patch<SetupItem>;
  softDeleteSetup: (id: string) => void;
  // Editors the capture sheet owns (each closes the sheet and opens a form).
  onEditTask: (task: HouseholdTask) => void;
  onEditGrocery: (item: GroceryItem) => void;
  onEditCost: (item: CostItem) => void;
  onEditSetup: (item: SetupItem) => void;
  /** Close the sheet ahead of a row's own navigation (checklist and recipe rows). */
  onBeforeNavigate: () => void;
  /** A plain row's click (core's resolveGlobalHitAction decides nav vs sheet). */
  onHitClick: (hit: GlobalHit) => void;
}

/** A hit with no row of its own: section tile, title, one meta line, chevron. */
function PlainHitRow({ hit, onClick }: { hit: GlobalHit; onClick: () => void }) {
  const sectionId = GLOBAL_HIT_SECTION_ID[hit.section];
  const action = resolveGlobalHitAction(hit);
  return (
    <ListItem asChild>
      <button type="button" onClick={onClick} className="cursor-pointer">
        <LeadingTile sectionId={sectionId} Icon={sectionIconFor(sectionId)} size="md" />
        <ListItemContent>
          <ListItemTitle>
            <span className="truncate">{hit.title}</span>
          </ListItemTitle>
          {hit.subtitle ? (
            <ListItemMeta>
              <span className="truncate">{hit.subtitle}</span>
            </ListItemMeta>
          ) : null}
        </ListItemContent>
        {action.kind === "nav" && (
          <ListItemTrailing>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </ListItemTrailing>
        )}
      </button>
    </ListItem>
  );
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
  checklists,
  shopperWants = [],
  setupStores,
  onSetupStoreCreated,
  customAisles,
  libraryPriceFor,
  writeTask,
  patchTask,
  softDeleteTask,
  writeGrocery,
  softDeleteGrocery,
  patchCost,
  softDeleteCost,
  patchSetup,
  softDeleteSetup,
  onEditTask,
  onEditGrocery,
  onEditCost,
  onEditSetup,
  onBeforeNavigate,
  onHitClick,
}: CaptureSearchResultsProps) {
  const modules = useModules();
  const currency = useHouseholdCurrency();
  const hits = useFuzzySearch(index, query, ["title", "subtitle", "keywords"]).slice(0, RESULT_LIMIT);

  // Checklist items back both a task's "Checklist N/M" chip and a checklist
  // hit's meter; recipe ingredients back a recipe hit's have/need line. This
  // only mounts while a search is typed, so the stores wake only then.
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

  const checklistsById = useMemo(() => {
    const map: Record<string, Checklist> = {};
    for (const cl of checklists) map[cl.id] = cl;
    return map;
  }, [checklists]);
  const checklistItemsByChecklistId = useMemo(() => {
    const map: Record<string, ChecklistTaskItem[]> = {};
    for (const item of checklistTaskItems) (map[item.checklist_id] ??= []).push(item);
    for (const list of Object.values(map)) list.sort((a, b) => a.order - b.order);
    return map;
  }, [checklistTaskItems]);

  // ── Tasks: the Tasks page's handlers (apps/web/src/app/tasks/page.tsx) ──
  const snoozeWithUndo = useTaskSnoozeUndo(patchTask);
  const bumpBadge = () => window.dispatchEvent(new Event(HOUSEHOLD_TASKS_CHANGED_EVENT));
  const toggleTask = (task: HouseholdTask) => {
    // Core's completion rule: a recurring task spawns its next occurrence.
    const { update, createNextOccurrence } = applyTaskCompletion(task, !task.done, { nextId: crypto.randomUUID() });
    patchTask(task.id, update);
    if (createNextOccurrence) writeTask(createNextOccurrence);
    bumpBadge();
  };
  const deleteTask = (task: HouseholdTask) => {
    softDeleteTask(task.id);
    bumpBadge();
    toastUndoDelete(1, () => {
      patchTask(task.id, { deleted: false });
      bumpBadge();
    });
  };

  const renderRow = (hit: GlobalHit): ReactNode | null => {
    switch (hit.section) {
      case "tasks": {
        const task = tasks.find((t) => t.id === hit.id);
        if (!task) return null;
        return (
          <TaskRow
            task={task}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            currentUserId={currentUserId}
            onToggleComplete={toggleTask}
            onUpdate={(updated) => {
              writeTask(updated);
              bumpBadge();
            }}
            onSnooze={(t, dur: TaskSnooze) => snoozeWithUndo(t, dur, todayISO())}
            onEdit={onEditTask}
            onRequestDelete={deleteTask}
            checklistsById={checklistsById}
            checklistItemsByChecklistId={checklistItemsByChecklistId}
          />
        );
      }
      case "groceries": {
        const grocery = groceries.find((g) => g.id === hit.id);
        if (!grocery) return null;
        return (
          <GroceryItemCardStandalone
            item={grocery}
            groupId={groupId}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            customAisles={customAisles}
            libraryPriceCents={libraryPriceFor?.(grocery.name) ?? null}
            onUpdate={writeGrocery}
            onRequestDelete={async (it) => {
              if (await dialog.confirm({ title: `Remove “${it.name}” from the list?`, confirmLabel: "Remove", destructive: true })) {
                softDeleteGrocery(it.id);
              }
            }}
            onEdit={onEditGrocery}
          />
        );
      }
      case "costs": {
        const cost = costItems.find((c) => c.id === hit.id);
        if (!cost) return null;
        return (
          <CostCard
            item={cost}
            groupId={groupId}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            onUpdate={(updated) => patchCost(updated.id, updated)}
            onRequestDelete={(it) => {
              // The Costs page's delete: soft-delete + clear its reminders.
              softDeleteCost(it.id);
              void deleteCostReminders(it, createClient());
            }}
            onEdit={onEditCost}
          />
        );
      }
      case "setup": {
        const item = setupItems.find((s) => s.id === hit.id);
        if (!item) return null;
        return (
          <SetupItemCard
            item={item}
            groupId={groupId}
            stores={setupStores}
            onUpdate={(updated) => patchSetup(updated.id, updated)}
            onDelete={softDeleteSetup}
            onEdit={onEditSetup}
            onStoreCreated={onSetupStoreCreated}
          />
        );
      }
      case "checklists": {
        const list = checklistsById[hit.id];
        if (!list) return null;
        return <ChecklistRow list={list} items={checklistItemsByChecklistId[list.id] ?? []} onNavigate={onBeforeNavigate} />;
      }
      case "recipes": {
        const recipe = recipes.find((r) => r.id === hit.id);
        if (!recipe) return null;
        return (
          <RecipeRow
            recipe={recipe}
            ingredients={ingredients.filter((i) => i.recipe_id === recipe.id)}
            groceryItems={groceries}
            groceriesLinked={modules.feature("recipes.groceries")}
            onNavigate={onBeforeNavigate}
          />
        );
      }
      case "shopper": {
        const want = shopperWants.find((w) => w.id === hit.id);
        if (!want) return null;
        return <WantRow row={summarizeWants([want], [], todayISO())[0]} currency={currency} onNavigate={onBeforeNavigate} />;
      }
      default:
        return null;
    }
  };

  if (hits.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        {docsLoading ? "Searching…" : `No matches for “${query.trim()}”`}
      </p>
    );
  }

  // Group the (relevance-ranked, capped) hits by section so each cluster sits
  // under one micro label instead of repeating the section on every row.
  const groups: { label: string; hits: GlobalHit[] }[] = [];
  for (const hit of hits) {
    const group = groups.find((g) => g.label === hit.sectionLabel);
    if (group) group.hits.push(hit);
    else groups.push({ label: hit.sectionLabel, hits: [hit] });
  }

  return (
    // Bounded scroll region (FLUX-176 point 3): the sheet, the field and the
    // keyboard always fit without redundant scrolling.
    <div className="max-h-[34dvh] space-y-3 overflow-y-auto">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {group.label}
          </h3>
          <ListGroup>
            {group.hits.map((hit) => (
              <div key={`${hit.section}-${hit.id}`}>
                {renderRow(hit) ?? <PlainHitRow hit={hit} onClick={() => onHitClick(hit)} />}
              </div>
            ))}
          </ListGroup>
        </section>
      ))}
    </div>
  );
}
