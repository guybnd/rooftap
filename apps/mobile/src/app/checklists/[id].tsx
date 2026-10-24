// HOUP-79: native Checklists — checklist detail (the cross-section nexus).
// Faithful-but-focused port of apps/web/src/app/checklists/[id]/page.tsx: item
// add/check/uncheck/reorder/delete, the scheduled-date ↔ linked dashboard to-do
// sync, Shopping cost logging, Repeating cadence/renewal + explicit renew
// banner, and manual "Start again". Reuses useChecklistToggle from
// @homeup/core (promoted this ticket) so check/uncheck side effects never fork
// from the web detail page or the /tasks inline panel.
//
// Deferred vs. the web page (named, not dropped): the "✓ checked by <name>"
// attribution shows the checked date only, no member name — apps/mobile's
// useDataCache() has no memberProfiles field yet (same gap HOUP-81 already
// flagged and deferred for assignee display). Wire this once a screen
// promotes memberProfiles into the native DataCacheProvider.
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  ArrowLeft,
  CalendarDays,
  RotateCcw,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
} from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  Button,
  Card,
  ChecklistAddWell,
  ChecklistItemList,
  DateScrollField,
  Input,
  LeadingTile,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ProgressBar,
  ReorderableList,
  ScreenBackground,
  SegmentedControl,
  Switch,
  cn,
  haptics,
} from '@homeup/ui';
import {
  checklists$,
  checklistItems$,
  householdTasks$,
  costItems$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useChecklistItemActions,
  useChecklistViewPrefs,
  useModules,
  typeMeta,
  completion,
  spendTotals,
  centsToDollars,
  liveItems,
  buildLinkedTask,
  cloneRun,
  isRepeatingDue,
  addDays,
  deterministicId,
  todayISO,
  renameChecklistPatch,
  RENEWAL_MODES,
  CHECKLIST_SORT_LABELS,
  availableSortModes,
  sortItems,
  partitionDone,
  type Checklist,
  type ChecklistTaskItem,
  type ChecklistRenewalMode,
  currencySymbol,
  dialog,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { useModuleSettingsSheet } from '@/features/settings/module-settings-sheet';
import { NoGroupScreen } from '@/components/no-group-screen';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import { useOpenRoute } from '@/lib/tab-routes';
import { checklistTypeIcon, scheduledDateMeta, SCHEDULED_TONE_CLASS } from '@/features/checklists/checklist-ui';

// HOUP-174 (E2): micro-label group headers, same class combo as
// apps/mobile/src/app/settings/index.tsx's GroupLabel — not exported from
// there (that file is app-local), so this screen's own copy.
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="cap-inscription px-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {children}
    </Text>
  );
}

// HOUP-327: header overflow menu rows — same MenuItem/BackRow/PropertyValue
// idiom as apps/mobile/src/features/tasks/task-quick-menu.tsx (E1-E3:
// current value shown as trailing text + chevron, selection as accent text +
// a trailing check, a back row to return from a sub-panel).
function PropertyValue({ children }: { children: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Text numberOfLines={1} className="max-w-[9rem] text-body text-muted-foreground">
        {children}
      </Text>
      <ChevronRight size={14} className="text-muted-foreground" />
    </View>
  );
}

function MenuItem({
  label,
  trailing,
  onPress,
  active,
  danger,
  disabled,
}: {
  label: string;
  trailing?: React.ReactNode;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className={danger ? 'text-body font-medium text-destructive' : 'text-body text-foreground'}>{label}</Text>
      <View className="flex-row items-center gap-1.5">
        {trailing}
        {active && <Check size={16} className="text-primary" />}
      </View>
    </Pressable>
  );
}

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-2 rounded-lg px-3 py-2.5">
      <ChevronLeft size={16} className="text-muted-foreground" />
      <Text className="text-body font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

type MenuView = 'menu' | 'sort' | 'rename';

export default function ChecklistDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { id: checklistId } = useLocalSearchParams<{ id: string }>();
  const { group, currentUserId, userSettings, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: creating the date's dashboard to-do needs Tasks and Checklists
  // (module-features.ts). Off: the list keeps its own date and no new to-do
  // is written, but one that already exists still follows the list (date,
  // title, done, removal), so it is right when Tasks comes back.
  const syncTask = modules.feature('tasks.checklists');
  // Modules: the "log costs" option needs Costs and Checklists (module-features.ts).
  const logCostsOn = modules.feature('costs.from-checklists');

  const lists$ = checklists$(group?.id);
  const items$ = checklistItems$(group?.id);
  const tasks$ = householdTasks$(group?.id);
  const costs$ = costItems$(logCostsOn ? group?.id : undefined);
  useReconnectSync(lists$);
  useReconnectSync(items$);
  useReconnectSync(tasks$);
  useReconnectSync(costs$);

  const { writeRow: writeList, patchRow: patchList, softDeleteRow: softDeleteList } = useStoreHelpers(lists$, currentUserId);
  const { writeRow: writeItem, patchRow: patchItem, softDeleteRow: softDeleteItem } = useStoreHelpers(items$, currentUserId);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: softDeleteTask } = useStoreHelpers(tasks$, currentUserId);
  const storeLoaded = useStoreLoaded(lists$, items$);

  const checklist = use$(() => {
    const rec = lists$.get() ?? {};
    const c = (rec as Record<string, Checklist>)[checklistId];
    return c && !c.deleted ? c : null;
  });

  // D7: the flat, order-ascending, unpartitioned array. Reorder mode and every
  // "true order" consumer (reindex on drop) read THIS, never the sorted/
  // partitioned display array below — sorting or sinking done items to a
  // band is a view, and must never perturb real manual order.
  const orderedItems = use$(() =>
    Object.values(items$.get() ?? {})
      .filter((i): i is ChecklistTaskItem => !!i && !i.deleted && i.checklist_id === checklistId)
      .sort((a, b) => a.order - b.order)
  );

  // HOUP-304: "Remove date" demoted from an inline full-width row action into
  // this sheet's own action (Decision 2 default, Hearth M4).
  const [showDateSheet, setShowDateSheet] = React.useState(false);
  // HOUP-200: drag-to-reorder toggle, mirrors HOUP-129 Setup / HOUP-175
  // Groceries' reorderMode convention (mutually exclusive with the row's own
  // tap-to-check/delete controls per ReorderableList's safety contract).
  const [reorderMode, setReorderMode] = React.useState(false);
  // HOUP-327: header overflow menu (replaces the resting Trash2) + its Sort
  // sub-panel (E3 — back row, selection as accent text + check).
  const [showMenuSheet, setShowMenuSheet] = React.useState(false);
  const settings = useModuleSettingsSheet('checklists');
  const [menuView, setMenuView] = React.useState<MenuView>('menu');
  // HOUP-328: List rename sub-panel draft — set when entering the panel.
  const [renameDraft, setRenameDraft] = React.useState('');

  const viewPrefs = useChecklistViewPrefs(checklistId, checklist?.type ?? 'plain', {
    sortMode: userSettings?.checklists_default_sort ?? null,
    completedToBottom: userSettings?.checklists_completed_to_bottom ?? true,
    collapsed: userSettings?.checklists_collapse_completed ?? false,
  });

  // View-only projection (D2): sort never writes `order`. When "Completed to
  // bottom" is on, done rows split into their own band below open rows; when
  // off, the sorted array renders flat (done rows stay wherever the sort put
  // them, still individually muted).
  const sortedItems = React.useMemo(
    () => sortItems(orderedItems, viewPrefs.sortMode),
    [orderedItems, viewPrefs.sortMode],
  );
  const { open: openItems, done: doneItems } = React.useMemo(
    () => partitionDone(sortedItems),
    [sortedItems],
  );

  const { done, total, complete } = completion(orderedItems);
  // HOUP-330: running total for shopping lists — one fragment on the count
  // line (H6), hidden when no item carries a price.
  const { spentCents, totalCents } = React.useMemo(() => spendTotals(orderedItems), [orderedItems]);

  // HOUP-332: the one item-write hook (add/delete/restore/rename/reprice),
  // composing useChecklistToggle internally so the completion sync stays
  // owned in one place — shared with the web detail page + the /tasks inline
  // panel. `addItems`/`deleteItem`/`restoreItems` read state through an
  // internal freshness ref, so binding them once here (and again inside the
  // memoized undo presenter below) is safe even though an Undo tap fires long
  // after the render that armed it.
  const actions = useChecklistItemActions(checklist, orderedItems, currentUserId);
  const { toggleItem, setItemsDone, syncAfterClear } = actions;

  // HOUP-245: delete-undo pill for checklist items. `restoreItems` reads fresh
  // state via its own internal ref, so capturing it once here (memoized with
  // `[]`) is safe even though Undo fires well after this render.
  const checklistUndo = React.useMemo(
    () =>
      createUndoToastPresenter<ChecklistTaskItem>({
        message: (count) => (count === 1 ? 'Item deleted' : `${count} items deleted`),
        restore: (item) => actions.restoreItems([item]),
        // D4: a batched restore (Clear completed undone all at once) fires ONE
        // completion sync against the fully-restored projection, never N syncs
        // each racing the next against a stale intermediate state.
        restoreAll: (restored) => actions.restoreItems(restored),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // HOUP-200/HOUP-304: drag-to-reorder via ReorderableList (HOUP-129/HOUP-175
  // pattern) — reindexes `order` 0..n over the full list on drop. The resting
  // up/down arrows this used to share with web's `move()` are gone (Hearth
  // §6 "retired from rows everywhere"); reordering now lives in Reorder mode
  // only.
  const reorderItems = (nextOrderedIds: string[]) => {
    nextOrderedIds.forEach((id, index) => patchItem(id, { order: index } as Partial<ChecklistTaskItem>));
  };

  const deleteItem = (item: ChecklistTaskItem) => {
    haptics.remove();
    actions.deleteItem(item);
    checklistUndo.addAndShow(item);
  };

  // HA: a single check that finishes the list gets the same celebrate() roll as
  // a bulk Check all — computed against orderedItems (the true, unsorted set)
  // so band/sort never change what counts as "the last open row".
  const handleToggle = (item: ChecklistTaskItem) => {
    const completing = !item.is_done && orderedItems.every((i) => i.id === item.id || i.is_done);
    toggleItem(item);
    if (completing) haptics.celebrate();
    else if (!item.is_done) haptics.tick();
    else haptics.select();
  };

  const checkAll = () => {
    if (openItems.length === 0) return;
    setItemsDone(openItems, true);
    haptics.celebrate();
    setShowMenuSheet(false);
  };

  const uncheckAll = () => {
    if (doneItems.length === 0) return;
    setItemsDone(doneItems, false);
    haptics.select();
    setShowMenuSheet(false);
  };

  const clearCompleted = () => {
    if (doneItems.length === 0) return;
    doneItems.forEach((item) => {
      softDeleteItem(item.id);
      checklistUndo.addAndShow(item);
    });
    syncAfterClear(openItems);
    haptics.remove();
    setShowMenuSheet(false);
  };

  const confirmDeleteList = () => {
    if (!checklist) return;
    dialog.alert(`Delete "${checklist.title}"?`, 'This removes the whole list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setShowMenuSheet(false);
          deleteChecklist();
        },
      },
    ]);
  };

  const setScheduledDate = (newDate: string | null) => {
    if (!checklist) return;
    if (newDate) {
      patchList(checklist.id, { scheduled_date: newDate } as Partial<Checklist>);
      if (checklist.linked_task_id) {
        patchTask(checklist.linked_task_id, { due_date: newDate });
      } else if (syncTask) {
        const task = buildLinkedTask({ checklist: { ...checklist, scheduled_date: newDate }, createdBy: currentUserId });
        writeTask(task);
        patchList(checklist.id, { linked_task_id: task.id } as Partial<Checklist>);
      }
    } else {
      if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
      patchList(checklist.id, { scheduled_date: null, linked_task_id: null } as Partial<Checklist>);
    }
  };

  const setCadence = (days: number | null) => checklist && patchList(checklist.id, { repeat_cadence_days: days } as Partial<Checklist>);
  const setRenewalMode = (mode: ChecklistRenewalMode) => checklist && patchList(checklist.id, { repeat_renewal_mode: mode } as Partial<Checklist>);
  const setLogCosts = (on: boolean) => checklist && patchList(checklist.id, { log_costs: on } as Partial<Checklist>);

  // HOUP-328: title rename from the menu's Rename row — empty submit reverts
  // (renameChecklistPatch returns null). A linked dashboard to-do's title
  // follows, same convention as setScheduledDate keeping the linked task's
  // due_date in sync.
  const commitRename = () => {
    if (checklist) {
      const patch = renameChecklistPatch(renameDraft);
      if (patch) {
        patchList(checklist.id, patch as Partial<Checklist>);
        if (checklist.linked_task_id) patchTask(checklist.linked_task_id, { title: patch.title });
        haptics.tick();
      }
    }
    setShowMenuSheet(false);
    setMenuView('menu');
  };

  const startAgain = () => {
    if (!checklist) return;
    const { checklist: fresh, items: freshItems } = cloneRun({ source: checklist, items: orderedItems, scheduledDate: checklist.scheduled_date, createdBy: currentUserId });
    writeList(fresh);
    freshItems.forEach(writeItem);
    if (syncTask && fresh.scheduled_date) {
      const task = buildLinkedTask({ checklist: fresh, createdBy: currentUserId });
      writeTask(task);
      patchList(fresh.id, { linked_task_id: task.id } as Partial<Checklist>);
    }
    if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
    patchList(checklist.id, { completed_at: new Date().toISOString() } as Partial<Checklist>);
    router.push(`/checklists/${fresh.id}` as Href);
  };

  const deleteChecklist = () => {
    if (!checklist) return;
    if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
    softDeleteList(checklist.id);
    router.back();
  };

  const renewDue = !!checklist && !checklist.completed_at && isRepeatingDue(checklist, todayISO());

  const renewNow = () => {
    if (!checklist || checklist.completed_at) return;
    const today = todayISO();
    if (!isRepeatingDue(checklist, today)) return;
    const cadence = checklist.repeat_cadence_days ?? 7;
    const nextDate = addDays(checklist.scheduled_date as string, cadence);

    if ((checklist.repeat_renewal_mode ?? 'clone') === 'reset') {
      liveItems(orderedItems).forEach((it) => {
        if (it.is_done || it.linked_cost_item_id) {
          patchItem(it.id, { is_done: false, checked_by: null, checked_at: null, linked_cost_item_id: null } as Partial<ChecklistTaskItem>);
        }
      });
      patchList(checklist.id, { scheduled_date: nextDate, completed_at: null } as Partial<Checklist>);
      if (checklist.linked_task_id) patchTask(checklist.linked_task_id, { due_date: nextDate, done: false, completed_at: null });
    } else {
      const idSeed = `${checklist.id}:${nextDate}`;
      const { checklist: fresh, items: freshItems } = cloneRun({ source: checklist, items: orderedItems, scheduledDate: nextDate, createdBy: currentUserId, idSeed });
      writeList(fresh);
      freshItems.forEach(writeItem);
      if (syncTask) {
        const task = buildLinkedTask({ checklist: fresh, createdBy: currentUserId, id: deterministicId(`task:${idSeed}`) });
        writeTask(task);
        patchList(fresh.id, { linked_task_id: task.id } as Partial<Checklist>);
      }
      if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
      patchList(checklist.id, { completed_at: new Date().toISOString() } as Partial<Checklist>);
      router.replace(`/checklists/${fresh.id}` as Href);
    }
  };

  if (cacheLoading || (!storeLoaded && !checklist)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  if (!checklist) {
    return (
      <ScreenBackground className="items-center justify-center gap-3 p-6">
        <Text className="text-body text-muted-foreground">Checklist not found.</Text>
        <Button variant="outline" size="sm" onPress={() => openRoute('/checklists')}>
          Back to all checklists
        </Button>
      </ScreenBackground>
    );
  }

  const meta = typeMeta(checklist.type);
  const renewalMode = checklist.repeat_renewal_mode ?? 'clone';
  const date = checklist.scheduled_date ? scheduledDateMeta(checklist.scheduled_date, { long: true }) : null;

  return (
    <ScreenBackground>
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      >
        {/* Header */}
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
          >
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          {/* v2 (E1): the header wears the same tile the row does. */}
          <LeadingTile sectionId="checklists" Icon={checklistTypeIcon(checklist.type)} size="md" />
          <Text numberOfLines={2} className="min-w-0 flex-1 font-heading text-display font-bold text-foreground">
            {checklist.title}
          </Text>
          {/* D3: the resting Trash2 moves into the menu's Danger group below. */}
          <Pressable
            onPress={() => {
              setMenuView('menu');
              setShowMenuSheet(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="More"
            className="h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted"
          >
            <MoreHorizontal size={16} className="text-muted-foreground" />
          </Pressable>
        </View>

        {/* Repeating: due-to-renew card, explicit action, never passive. H2: a
            neutral card with the section tile; its button is the one primary. */}
        {renewDue && (
          <Card className="rounded-3xl">
            <View className="flex-row flex-wrap items-center gap-3 px-4">
              <LeadingTile sectionId="checklists" Icon={RotateCcw} size="md" />
              <View className="min-w-0 flex-1">
                <Text className="text-body font-semibold text-foreground">Due to renew</Text>
                <Text className="text-caption text-muted-foreground">
                  {renewalMode === 'clone' ? 'A fresh copy replaces this run' : 'Every item unchecks'}
                </Text>
              </View>
              <Button size="sm" onPress={renewNow}>
                {renewalMode === 'clone' ? 'Start next cycle' : 'Reset for next cycle'}
              </Button>
            </View>
          </Card>
        )}

        {/* Settings card: one v2 card, hairline dividers between its rows (H4). */}
        <Card className="rounded-3xl">
          <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4">
            {checklist.completed_at ? (
              <Text className="text-caption font-medium text-success">Completed</Text>
            ) : (
              <Text className="text-caption text-muted-foreground">{meta.label}</Text>
            )}
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {done} of {total} done
              {checklist.type === 'shopping' && totalCents > 0 && (
                <>
                  {' · '}
                  <Text className="text-foreground">{currencySymbol()}{centsToDollars(spentCents)}</Text>
                  {` of $${centsToDollars(totalCents)}`}
                </>
              )}
            </Text>
          </View>
          {total > 0 && <ProgressBar value={done} total={total} className="mx-4 h-[3px] w-auto" />}

          {/* Date property row (E2): shows its value, tap opens the date
              sheet (picker + Remove, Hearth M4). Same row on web. */}
          <Pressable
            onPress={() => setShowDateSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={syncTask ? 'Date on dashboard' : 'Date'}
            className="min-h-11 flex-row items-center gap-3 border-t border-border/60 px-4 pt-3"
          >
            <CalendarDays size={16} className="text-muted-foreground" />
            <Text className="flex-1 text-body text-foreground">{syncTask ? 'Date on dashboard' : 'Date'}</Text>
            <Text
              className={cn(
                'text-caption',
                date ? SCHEDULED_TONE_CLASS[date.tone] : 'text-muted-foreground',
                date && date.tone !== 'muted' && 'font-medium'
              )}
            >
              {date ? date.label : 'Add date'}
            </Text>
            <ChevronRight size={14} className="text-muted-foreground" />
          </Pressable>

          {/* Shopping: cost-logging toggle */}
          {checklist.type === 'shopping' && logCostsOn && (
            <View className="min-h-11 flex-row items-center gap-3 border-t border-border/60 px-4 pt-3">
              <Text className="flex-1 text-body text-foreground">Log checked items in Costs</Text>
              <Switch checked={checklist.log_costs} onChange={setLogCosts} label="Log checked items in Costs" />
            </View>
          )}

          {/* Repeating: cadence + renewal mode */}
          {checklist.type === 'repeating' && (
            <View className="gap-2 border-t border-border/60 px-4 pt-3">
              <View className="flex-row items-center gap-2">
                <RotateCcw size={14} className="text-muted-foreground" />
                <Text className="text-sm text-foreground">Repeats every</Text>
                <Input
                  keyboardType="number-pad"
                  value={String(checklist.repeat_cadence_days ?? 7)}
                  onChangeText={(v) => setCadence(parseInt(v, 10) || null)}
                  className="w-14 text-center"
                />
                <Text className="text-sm text-foreground">days</Text>
              </View>
              <SegmentedControl
                options={RENEWAL_MODES.map((m) => ({ value: m, label: m === 'clone' ? 'Clone a fresh copy' : 'Reset in place' }))}
                value={renewalMode}
                onChange={setRenewalMode}
                accessibilityLabel="Renewal"
              />
              <Text className="text-xs text-muted-foreground">
                {renewalMode === 'clone'
                  ? 'On the date, this run archives and a fresh copy starts.'
                  : 'On the date, every item unchecks.'}
              </Text>
            </View>
          )}
        </Card>

        <BottomSheet open={showDateSheet} onOpenChange={setShowDateSheet}>
          <View className="gap-3 px-4 pb-4">
            <Text className="text-sm font-medium text-foreground">{syncTask ? 'Date on dashboard' : 'Date'}</Text>
            <DateScrollField
              value={checklist.scheduled_date ?? ''}
              onChange={(v) => setScheduledDate(v)}
              emptyLabel="No date. Spin to pick one"
            />
            {/* E4: destructive sits alone, danger text, no fill. */}
            {checklist.scheduled_date && (
              <Pressable
                onPress={() => {
                  setScheduledDate(null);
                  setShowDateSheet(false);
                }}
                accessibilityRole="button"
                className="min-h-11 items-center justify-center border-t border-border/60"
              >
                <Text className="text-body font-medium text-destructive">Remove date</Text>
              </Pressable>
            )}
          </View>
        </BottomSheet>

        {settings.sheet}

        {/* HOUP-327: header overflow menu (D3 — Delete list is the lone
            danger row here, replacing the resting Trash2 above). */}
        <BottomSheet open={showMenuSheet} onOpenChange={setShowMenuSheet}>
          <View className="gap-0.5 px-1 pb-1">
            {menuView === 'menu' && (
              <>
                <GroupLabel>List</GroupLabel>
                <MenuItem
                  label="Sort"
                  trailing={<PropertyValue>{CHECKLIST_SORT_LABELS[viewPrefs.sortMode]}</PropertyValue>}
                  onPress={() => setMenuView('sort')}
                />
                <View className="flex-row items-center justify-between gap-2 px-3 py-2.5">
                  <Text className="text-body text-foreground">Completed to bottom</Text>
                  <Switch checked={viewPrefs.completedToBottom} onChange={viewPrefs.setCompletedToBottom} />
                </View>
                <MenuItem
                  label="Rename"
                  trailing={<PropertyValue>{checklist.title}</PropertyValue>}
                  onPress={() => {
                    setRenameDraft(checklist.title);
                    setMenuView('rename');
                  }}
                />

                <View className="my-1 h-px bg-border" />

                <GroupLabel>Items</GroupLabel>
                {openItems.length > 0 && <MenuItem label="Check all" onPress={checkAll} />}
                {doneItems.length > 0 && <MenuItem label="Uncheck all" onPress={uncheckAll} />}
                <MenuItem
                  label={`Clear completed · ${doneItems.length}`}
                  onPress={clearCompleted}
                  disabled={doneItems.length === 0}
                />

                {settings.available ? (
                  <>
                    <View className="my-1 h-px bg-border" />
                    {/* The defaults for every list; Sort and Completed to bottom above are this list's. */}
                    <MenuItem
                      label={settings.label}
                      onPress={() => {
                        setShowMenuSheet(false);
                        settings.open();
                      }}
                    />
                  </>
                ) : null}

                <View className="my-1 h-px bg-border" />

                <GroupLabel>Danger</GroupLabel>
                <MenuItem label="Delete list" danger onPress={confirmDeleteList} />
              </>
            )}

            {menuView === 'sort' && (
              <>
                <BackRow label="Sort" onPress={() => setMenuView('menu')} />
                {availableSortModes(checklist.type).map((mode) => (
                  <MenuItem
                    key={mode}
                    label={CHECKLIST_SORT_LABELS[mode]}
                    active={viewPrefs.sortMode === mode}
                    onPress={() => {
                      haptics.select();
                      viewPrefs.setSortMode(mode);
                      setReorderMode(false);
                      setMenuView('menu');
                    }}
                  />
                ))}
              </>
            )}

            {menuView === 'rename' && (
              <>
                <BackRow label="Rename" onPress={() => setMenuView('menu')} />
                <View className="gap-2 px-3 py-2">
                  <Input
                    value={renameDraft}
                    onChangeText={setRenameDraft}
                    autoFocus
                    selectTextOnFocus
                    onSubmitEditing={commitRename}
                    returnKeyType="done"
                  />
                </View>
              </>
            )}
          </View>
        </BottomSheet>

        {/* Items — HOUP-332: shared ChecklistItemList primitive (also used by
            the /tasks + home-hero inline panel) owns resting rows + the add
            well; reorder mode stays a detail-only affordance rendered here. */}
        {orderedItems.length > 1 && viewPrefs.sortMode === 'manual' && (
          <View className="flex-row items-center justify-end px-1">
            <Button size="sm" variant={reorderMode ? 'default' : 'outline'} onPress={() => setReorderMode((v) => !v)}>
              {reorderMode ? 'Done' : 'Reorder'}
            </Button>
          </View>
        )}
        {reorderMode && viewPrefs.sortMode === 'manual' && orderedItems.length > 1 ? (
          // D7: reorder always drags the flat, order-ascending array — never
          // the sorted/partitioned display — so a drop reindexes real manual
          // order faithfully regardless of the active sort/band. Gate mirrors
          // the Reorder button's own condition above so a sort change (or a
          // concurrent delete dropping the count to 1) can never strand this
          // branch on screen with no way back to the normal list.
          <>
            <ReorderableList
              data={orderedItems}
              keyExtractor={(item) => item.id}
              onReorder={reorderItems}
              renderItem={(item, dragging) => (
                <ListItem className={dragging ? 'bg-accent/30' : undefined}>
                  <ListItemLeading>
                    <GripVertical size={16} className="text-muted-foreground" />
                  </ListItemLeading>
                  <ListItemContent>
                    <Text className={`text-sm ${item.is_done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {item.label}
                    </Text>
                  </ListItemContent>
                </ListItem>
              )}
            />
            {/* Review fix (HOUP-332): the add well used to be an unconditional
                sibling here; moving it inside ChecklistItemList hid it whenever
                reorder mode swapped that primitive out for ReorderableList. */}
            <ChecklistAddWell checklist={checklist} orderedItems={orderedItems} onAdd={actions.addItems} />
          </>
        ) : (
          <ChecklistItemList
            checklist={checklist}
            orderedItems={orderedItems}
            viewPrefs={viewPrefs}
            variant="detail"
            onToggle={handleToggle}
            onAdd={actions.addItems}
            onRename={actions.renameItem}
            onReprice={actions.repriceItem}
            onDelete={deleteItem}
          />
        )}

        {/* Start again (when complete or archived) */}
        {(complete || checklist.completed_at) && (
          <Button variant="outline" onPress={startAgain} className="h-11">
            <RotateCcw size={14} className="text-foreground" />
            <Text className="text-sm font-medium text-foreground">Start again</Text>
          </Button>
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}
