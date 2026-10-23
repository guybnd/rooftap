// HOUP-81: native Tasks — live data via HOUP-86's native StoreEnvironment +
// useDataCache() provider. Reuses @homeup/core's household-tasks bucketing/
// recurrence and the Legend store verbatim (HOUP-73).
//
// HOUP-120 closed the parity gaps this file's header used to list (hold
// quick-edit menu, assignee reassignment, snooze, inline title/date/notes
// editing, free-form recurrence) — see @/features/tasks/task-row.tsx and
// household-task-modal.tsx.
//
// HOUP-121 closed the list-controls gap: fuzzy search (promoted to
// @homeup/core so it's shared with web), an All/Mine filter, a Date/Person
// grouping switch (adds the "By person" view), a richer "open · overdue ·
// done" lede, a Completed filter chip in the controls cluster, distinct
// empty-vs-no-match states, and deep-link focus (scroll + highlight).
//
// HOUP-122 closed the remaining moving-specific gap: the moving-template
// generator (header action sheet + empty-state CTA), the dismissible move-in
// countdown header, and the out-of-sync "Update dates" banner + manual
// Refresh — ported from apps/web/src/app/tasks/page.tsx.
//
// HOUP-123 closes the last parity gap: the Comments + Checklist N/M portal
// chips (checklistsById/checklistItemsByChecklistId derivation mirrors
// apps/web/src/app/tasks/page.tsx's own — see @/features/tasks/task-row.tsx).
//
// HOUP-206: ScrollView -> FlashList. Scroll-restore-to-focused-row now goes
// through FlashListRef.scrollToIndex instead of a measure()+scrollTo() UI-thread
// worklet, so the `useAnimatedRef`/`useScrollViewOffset`/`measure` reanimated
// coupling this file used to have is gone — that coupling existed only to convert
// measure()'s page-relative delta into a content-relative scroll target, a
// non-issue once the target is addressed by flattened-data index instead of a
// live-measured ref.
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { use$ } from '@legendapp/state/react';
import { syncState } from '@legendapp/state';
import * as SecureStore from 'expo-secure-store';
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react-native';
import {
  Text,
  Button,
  Card,
  LeadingTile,
  HeroLede,
  Input,
  ScreenBackground,
  SectionSearchBar,
  SegmentedControl,
  cn,
  toast,
  type SegmentOption, haptics } from '@homeup/ui';
import {
  type TaskSnooze,
  applyTaskCompletion,
  bucketTasksByDueDate,
  checklistItemsByChecklistId,
  checklistsById,
  compareTasksByDueDateTimeOrder,
  groupTasksByPerson,
  moveInCountdown,
  checklistItems$,
  checklists$,
  createPendingActionTracker,
  findOutOfSyncTasks,
  generateMovingTasks,
  isMovingActive,
  householdTasks$,
  splitUpcomingByWindow,
  upcomingWindowDays,
  syncMovingTaskDates,
  taskFieldPatch,
  todayISO,
  usePendingIds,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useEntityCommentCounts,
  isTaskOwnerEnabled,
  useModules,
  type Checklist,
  type ChecklistTaskItem,
  type HouseholdTask,
  type TaskEditableField,
} from '@homeup/core';
// Direct path: the barrel deliberately doesn't export client hooks (they break
// apps/web's server-route builds — see core/src/index.ts).
import { useFuzzySearch } from '@homeup/core/src/hooks/use-fuzzy-search';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { TaskRow } from '@/features/tasks/task-row';
import { HouseholdTaskModal } from '@/features/tasks/household-task-modal';
import { TasksActionSheet } from '@/features/tasks/tasks-action-sheet';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { perfMark } from '@/lib/perf-log';
import { whyRender } from '@/lib/why-render';
import { randomUUID } from '@/lib/uuid';
import { isFlagParamSet } from '@/lib/route-params';
import { createHouseholdTaskModalCallbacks } from '@/features/tasks/deferred-sheet-close';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import { useTaskSnoozeUndo } from '@/features/tasks/use-task-snooze-undo';
import { flattenGroups, groupFrameClass, rowSpacingClassName, type SectionRow, type SectionTone } from '@homeup/ui';

// FLUX-193 parity: the move-in countdown is one-time info once you've moved
// in — dismissible, persisted per move-in date (a new date re-shows it).
const COUNTDOWN_DISMISSED_KEY = 'tasks_countdown_dismissed';

// FLUX-234 parity: "just added" tasks float above the normal buckets for a
// beat instead of being immediately re-sorted into a due-date section —
// ported from apps/web/src/app/tasks/page.tsx's pinNewTask/newTaskIds.
const PIN_MS = 15000;

type GroupBy = 'date' | 'person';
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

const MINE_OPTIONS: SegmentOption<'all' | 'mine'>[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
];
const GROUP_OPTIONS: SegmentOption<GroupBy>[] = [
  { value: 'date', label: 'Date', icon: <CalendarDays size={13} className="text-muted-foreground" /> },
  { value: 'person', label: 'Person', icon: <Users size={13} className="text-muted-foreground" /> },
];

// Section-header accent per tone (mirrors each bucket's prior accentClassName).
// Row id of the Later group's header, which doubles as its show/hide toggle.
const LATER_HEADER_ID = 'group-header:Later';

const TONE_CLASS: Record<SectionTone, string> = {
  primary: 'text-primary',
  destructive: 'text-destructive',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
  success: 'text-success',
};

// HOUP-206: this screen's original ScrollView rhythm (`gap-5` between sections,
// `gap-2` header-to-frame) differs from documents/index.tsx's `gap-4`/`gap-1.5` —
// pass explicit overrides to `rowSpacingClassName` rather than its defaults.
const ROW_SPACING = { groupGap: 'mt-5', headerGap: 'mt-2' };

// FLUX-60: same tiny resolver duplicated in task-quick-menu.tsx and
// document-row.tsx rather than centralized — matches this codebase's
// established convention for this one-off lookup.
function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

interface TasksListHeaderProps {
  openCount: number;
  overdueCount: number;
  doneCount: number;
  hasTasks: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onOpenActionSheet: () => void;
  onAddTask: () => void;
  countdown: { label: string; sub: string } | null;
  countdownDismissed: boolean;
  onDismissCountdown: () => void;
  outOfSyncCount: number;
  isSyncingDates: boolean;
  onSyncDates: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  mineOnly: boolean;
  onMineOnlyChange: (mineOnly: boolean) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  effectiveShowDone: boolean;
  onToggleShowDone: () => void;
  quickTitle: string;
  onQuickTitleChange: (value: string) => void;
  onQuickAdd: () => void;
}

/** HOUP-206: the tasks open-count lede, countdown/out-of-sync banners, search, filters
 * and quick-add, hoisted into `FlashList`'s `ListHeaderComponent` so they scroll with
 * content. Passed as a memoized element (never an inline closure) — see the `listHeader`
 * memo below — so the search bar and quick-add `Input`s never remount mid-type. */
function TasksListHeader({
  openCount,
  overdueCount,
  doneCount,
  hasTasks,
  searchOpen,
  onToggleSearch,
  onOpenActionSheet,
  onAddTask,
  countdown,
  countdownDismissed,
  onDismissCountdown,
  outOfSyncCount,
  isSyncingDates,
  onSyncDates,
  search,
  onSearchChange,
  mineOnly,
  onMineOnlyChange,
  groupBy,
  onGroupByChange,
  effectiveShowDone,
  onToggleShowDone,
  quickTitle,
  onQuickTitleChange,
  onQuickAdd,
}: TasksListHeaderProps) {
  return (
    <View className="gap-4 pb-4">
      {/* H1: one lede. Hearth v2 (Pulse): the open count as a Hero number
          under the section's glow; the actions sit on the label row above
          it. HOUP-173: no extra px-1 inset — aligns to the same edge as the
          section headers and card below. */}
      <View className="flex-row items-center justify-between">
        <Text className="text-micro-label uppercase text-muted-foreground">Tasks</Text>
        <View className="flex-row items-center gap-2">
          {hasTasks && (
            <Pressable
              onPress={onToggleSearch}
              accessibilityRole="button"
              accessibilityLabel="Search tasks"
              accessibilityState={{ selected: searchOpen || !!search }}
              className={`h-11 w-11 items-center justify-center rounded-lg border ${
                searchOpen || search ? 'border-primary/40 bg-primary/15' : 'border-border bg-muted'
              }`}
            >
              <Search size={16} className={searchOpen || search ? 'text-primary' : 'text-muted-foreground'} />
            </Pressable>
          )}
          {/* Overflow — occasional actions (refresh, generate) live here, not the primary row */}
          <Pressable
            onPress={onOpenActionSheet}
            accessibilityRole="button"
            accessibilityLabel="More actions"
            className="h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted"
          >
            <MoreHorizontal size={16} className="text-muted-foreground" />
          </Pressable>
          <Button size="sm" onPress={onAddTask}>
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>
      <HeroLede
        value={openCount}
        label="open"
        caption={
          overdueCount > 0 || doneCount > 0 ? (
            <>
              {overdueCount > 0 && <Text className="text-caption text-destructive">{overdueCount} overdue</Text>}
              {overdueCount > 0 && doneCount > 0 && ' · '}
              {doneCount > 0 && `${doneCount} done`}
            </>
          ) : undefined
        }
      />

      {/* Countdown header (only when a move-in date is set + not dismissed) */}
      {countdown && !countdownDismissed && (
        // Hearth v2 (H2): a neutral card with the Tasks tile; coral is for controls.
        <Card className="flex-row items-center gap-3 rounded-3xl px-4 py-3">
          <LeadingTile sectionId="household" Icon={CalendarClock} size="md" />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-foreground">{countdown.label}</Text>
            <Text className="text-xs text-muted-foreground">{countdown.sub}</Text>
          </View>
          <Pressable
            onPress={onDismissCountdown}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            className="shrink-0 rounded-md p-1"
          >
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        </Card>
      )}

      {/* Out-of-sync offer — move-in date changed since template tasks were generated */}
      {outOfSyncCount > 0 && (
        <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <View className="min-w-0 flex-shrink flex-row items-center gap-2">
            <AlertTriangle size={16} className="shrink-0 text-warning" />
            <Text className="text-sm text-warning">
              {outOfSyncCount} moving task{outOfSyncCount === 1 ? '' : 's'} {outOfSyncCount === 1 ? 'is' : 'are'} dated for a
              different move-in date.
            </Text>
          </View>
          <Pressable
            onPress={onSyncDates}
            disabled={isSyncingDates}
            accessibilityRole="button"
            className="rounded-lg border border-warning/40 bg-warning/20 px-3 py-1.5"
            style={isSyncingDates ? { opacity: 0.5 } : undefined}
          >
            <Text className="text-sm font-medium text-warning">{isSyncingDates ? 'Updating…' : 'Update dates'}</Text>
          </Pressable>
        </View>
      )}

      {/* Search — revealed from the header search icon (or whenever a query is active) */}
      {hasTasks && (searchOpen || search) && (
        <SectionSearchBar value={search} onChange={onSearchChange} placeholder="Search tasks…" autoFocus />
      )}

      {/* Filters + grouping (H5: controls live with what they control).
          HOUP-173: both controls use `fitContent` so they size to their
          own labels instead of each stretching to a full-width row — all
          three controls now share one line before content. */}
      <View className="flex-row items-center gap-2">
        <SegmentedControl
          options={MINE_OPTIONS}
          value={mineOnly ? 'mine' : 'all'}
          onChange={(v) => onMineOnlyChange(v === 'mine')}
          accessibilityLabel="All or mine"
          fitContent
        />
        <SegmentedControl
          options={GROUP_OPTIONS}
          value={groupBy}
          onChange={onGroupByChange}
          accessibilityLabel="Group by"
          fitContent
        />
        <Pressable
          onPress={() => {
            haptics.select();
            onToggleShowDone();
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: effectiveShowDone }}
          className={`rounded-full border px-3 py-1 ${
            effectiveShowDone ? 'border-success/30 bg-success/15' : 'border-border bg-muted'
          }`}
        >
          <Text className={`text-xs font-medium ${effectiveShowDone ? 'text-success' : 'text-muted-foreground'}`}>
            Completed
          </Text>
        </Pressable>
      </View>

      {/* Quick-add */}
      <View className="flex-row items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-1">
        <Input
          value={quickTitle}
          onChangeText={onQuickTitleChange}
          placeholder="Add a task…"
          onSubmitEditing={onQuickAdd}
          returnKeyType="done"
          className="flex-1 border-0 bg-transparent px-0"
        />
        {!!quickTitle.trim() && (
          <Button size="xs" variant="ghost" onPress={onQuickAdd}>
            Add
          </Button>
        )}
      </View>
    </View>
  );
}

export default function TasksSectionScreen() {
  // HOUP-240: fires on every mount, including react-freeze re-mounting this
  // screen's subtree on unfreeze.
  perfMark('tasks:render');
  const insets = useSafeAreaInsets();
  const dataCache = useDataCache();
  const { group, currentUserId, groupMembers, memberProfiles, userSettings, loading: cacheLoading } = dataCache;
  whyRender('tasks', { dataCache, group, currentUserId, groupMembers, memberProfiles, cacheLoading });

  const focusParam = useLocalSearchParams<{ focus?: string }>().focus;
  const focusId = Array.isArray(focusParam) ? focusParam[0] : focusParam;
  const addParam = useLocalSearchParams<{ add?: string }>().add;
  const addRequested = isFlagParamSet(addParam);

  const tasks$ = householdTasks$(group?.id);
  useReconnectSync(tasks$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(tasks$, currentUserId);
  const snoozeWithUndo = useTaskSnoozeUndo(patchRow);

  // HOUP-245: tick-off "linger" — completing a task doesn't drop it out of
  // its due-date bucket until this grace window elapses (re-tapping within
  // the window cleanly cancels). One tracker per screen (@/app/home/index.tsx
  // owns its own — its agenda list never hides completed-today tasks, so it
  // doesn't need one).
  const tickOffTracker = React.useMemo(() => createPendingActionTracker(), []);
  const pendingIds = usePendingIds(tickOffTracker);

  // HOUP-245: delete-undo pill, coalescing rapid deletes into one pill with
  // a running count. `restore` reads `patchRow` through a ref kept fresh
  // every render since the presenter itself is created once.
  const patchRowRef = React.useRef(patchRow);
  patchRowRef.current = patchRow;
  const taskDeleteUndo = React.useMemo(
    () =>
      createUndoToastPresenter<HouseholdTask>({
        message: (count) => (count === 1 ? 'Task deleted' : `${count} tasks deleted`),
        restore: (task) => patchRowRef.current(task.id, { deleted: false }),
      }),
    []
  );

  // HOUP-123: linked checklists — feeds the inline "Checklist N/M" chip + panel
  // on each TaskRow (mirrors apps/web/src/app/tasks/page.tsx's derivation).
  // Modules: not fetched with Checklists off; the row hides the chip itself
  // (tasks.checklists needs Tasks and Checklists, module-features.ts).
  const modules = useModules();
  const checklistsGroupId = modules.feature('tasks.checklists') ? group?.id : undefined;
  const checklistsStore$ = checklists$(checklistsGroupId);
  const checklistItemsStore$ = checklistItems$(checklistsGroupId);
  useReconnectSync(checklistsStore$);
  useReconnectSync(checklistItemsStore$);

  const checklists = use$(() =>
    Object.values(checklistsStore$.get() ?? {}).filter((c): c is Checklist => !!c && !c.deleted)
  );
  const checklistTaskItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistTaskItem => !!i && !i.deleted)
  );

  const checklistsMap = React.useMemo(() => checklistsById(checklists), [checklists]);
  const checklistItemsMap = React.useMemo(() => checklistItemsByChecklistId(checklistTaskItems), [checklistTaskItems]);

  const allTasks = use$(() =>
    Object.values(tasks$.get() ?? {})
      .filter((t): t is HouseholdTask => !!t && !t.deleted)
      .sort(compareTasksByDueDateTimeOrder)
  );
  // Modules: bill and document reminders go with Costs and Documents, so one
  // whose module is off leaves the list and its counts (task-modules.ts).
  const tasks = React.useMemo(
    () => allTasks.filter((t) => isTaskOwnerEnabled(t, modules.enabled)),
    [allTasks, modules.enabled]
  );
  const storeLoaded = useStoreLoaded(tasks$);
  whyRender('tasks:stores', { tasks$, tasks, storeLoaded, checklistsStore$, checklistItemsStore$, checklists, checklistTaskItems });

  const [showDone, setShowDone] = React.useState(false);
  const [showLater, setShowLater] = React.useState(false);
  const [mineOnly, setMineOnly] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [groupBy, setGroupBy] = React.useState<GroupBy>('date');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] = React.useState<HouseholdTask | undefined>();

  // HOUP-110: the widget's Tasks "+" deep-links here with ?add=1 (RemoteViews
  // has no text input, so it can only hand off to this screen's own add flow).
  // The flag is cleared once consumed: this screen now stays mounted between
  // visits (src/app/(tabs)), so a second widget tap would otherwise land on
  // an unchanged ?add=1 and open nothing.
  const router = useRouter();
  React.useEffect(() => {
    if (!addRequested) return;
    setEditingTask(undefined);
    setModalOpen(true);
    router.setParams({ add: undefined });
  }, [addRequested, router]);
  const [quickTitle, setQuickTitle] = React.useState('');
  const [actionSheetOpen, setActionSheetOpen] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isSyncingDates, setIsSyncingDates] = React.useState(false);
  const [countdownDismissed, setCountdownDismissed] = React.useState(false);

  const moveInDate = group?.home_move_in_date ?? null;

  // No effect needed for the !moveInDate case: `countdown` itself is null
  // then, so `countdownDismissed`'s value is inert until a date is set.
  React.useEffect(() => {
    if (!moveInDate) return;
    perfMark('tasks:effect:countdown:start');
    let cancelled = false;
    SecureStore.getItemAsync(COUNTDOWN_DISMISSED_KEY).then((stored) => {
      perfMark('tasks:effect:countdown:resolved');
      if (!cancelled) setCountdownDismissed(stored === moveInDate);
    });
    return () => {
      cancelled = true;
    };
  }, [moveInDate]);

  const dismissCountdown = () => {
    if (moveInDate) void SecureStore.setItemAsync(COUNTDOWN_DISMISSED_KEY, moveInDate);
    setCountdownDismissed(true);
  };

  const handleRefresh = () => {
    void syncState(tasks$).sync();
  };

  // Generate the curated moving template — idempotent (skips template_keys that exist).
  const handleGenerate = async () => {
    if (!group?.id) return;
    setIsGenerating(true);
    try {
      const supabase = getCurrentSupabaseClient();
      // Read existing template keys straight from the DB so a stale client view
      // can never cause duplicate rows.
      const { data: existingRows } = await supabase
        .from('household_tasks')
        .select('template_key')
        .eq('group_id', group.id)
        .not('template_key', 'is', null);
      const existingKeys = new Set((existingRows ?? []).map((r) => r.template_key as string));

      const inserted = await generateMovingTasks({
        groupId: group.id,
        region: group.region,
        moveInDate,
        existingTemplateKeys: existingKeys,
        supabase,
      });

      // Pull the new rows into the Legend store.
      void syncState(tasks$).sync();

      if (inserted === 0) {
        toast.message('Moving tasks are already up to date.');
      } else if (!moveInDate) {
        toast.success(`Added ${inserted} moving task${inserted === 1 ? '' : 's'}.`, {
          description: 'Set a move-in date in Settings to schedule them.',
        });
      } else {
        toast.success(`Added ${inserted} moving task${inserted === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      console.error('Failed to generate moving tasks:', error);
      toast.error('Could not generate moving tasks.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Shift pending template tasks to match the current move-in date.
  const handleSyncDates = async () => {
    if (!group?.id || !moveInDate) return;
    setIsSyncingDates(true);
    try {
      const supabase = getCurrentSupabaseClient();
      const count = await syncMovingTaskDates({ tasks, moveInDate, supabase });
      void syncState(tasks$).sync();
      toast.success(`Updated ${count} moving task date${count === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('Failed to sync task dates:', error);
      toast.error('Could not update moving task dates.');
    } finally {
      setIsSyncingDates(false);
    }
  };

  const [newTaskIds, setNewTaskIds] = React.useState<string[]>([]);
  const pinTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const pinNewTask = React.useCallback((id: string) => {
    setNewTaskIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
    const existing = pinTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setNewTaskIds((prev) => prev.filter((x) => x !== id));
      pinTimers.current.delete(id);
    }, PIN_MS);
    pinTimers.current.set(id, timer);
  }, []);

  React.useEffect(() => {
    const timers = pinTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Deep-link focus (/tasks?focus=<id>): scroll to + highlight the row, and
  // reveal it even if it's tucked behind the Completed toggle — derived
  // (not synced via an effect) so a completed focus target is never hidden.
  const focusedTaskDone = !!focusId && tasks.some((t) => t.id === focusId && t.done);
  const effectiveShowDone = showDone || focusedTaskDone;

  const listRef = React.useRef<FlashListRef<SectionRow<HouseholdTask>>>(null);

  const handleToggleComplete = (task: HouseholdTask) => {
    const nextDone = !task.done;
    const { update, createNextOccurrence } = applyTaskCompletion(task, nextDone, { nextId: randomUUID() });
    patchRow(task.id, update);
    if (createNextOccurrence) writeRow(createNextOccurrence);
    if (nextDone) tickOffTracker.schedule(task.id, () => {});
    else tickOffTracker.cancel(task.id);
  };

  const handleQuickAdd = () => {
    const title = quickTitle.trim();
    if (!title || !group?.id) return;
    const id = randomUUID();
    writeRow({
      id,
      group_id: group.id,
      title,
      due_date: todayISO(),
      due_time: null,
      offset_days: null,
      recurrence_days: null,
      done: false,
      completed_at: null,
      assigned_to: currentUserId ?? null,
      private: false,
      template_key: null,
      notes: null,
      sort_order: 0,
      priority: 'medium',
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
    haptics.commit();
    pinNewTask(id);
    setQuickTitle('');
  };

  // Swipe-left snooze (mirrors web's page.tsx handleSnooze).
  const handleSnooze = (task: HouseholdTask, dur: TaskSnooze) => {
    snoozeWithUndo(task, dur);
  };

  const handleReassign = (task: HouseholdTask, userId: string | null) => {
    patchRow(task.id, { assigned_to: userId });
  };

  const handlePriorityChange = (task: HouseholdTask, priority: HouseholdTask['priority']) => {
    patchRow(task.id, { priority });
  };

  const handleRecurrenceChange = (task: HouseholdTask, days: number | null) => {
    patchRow(task.id, { recurrence_days: days });
  };

  // Core's taskFieldPatch: an empty title is a no-op, and hand-setting a
  // moving task's date detaches it from the template (mirrors web).
  const handleFieldChange = (task: HouseholdTask, field: TaskEditableField, value: string) => {
    const payload = taskFieldPatch(task, field, value);
    if (payload) patchRow(task.id, payload);
  };

  // Client-side filter (mine only) — applied for display only.
  const mineFiltered = mineOnly ? tasks.filter((t) => t.assigned_to && t.assigned_to === currentUserId) : tasks;

  // Fuzzy search narrows the already-filtered set, then feeds bucketing/grouping
  // below (FLUX-110). Empty query returns mineFiltered unchanged.
  const visibleTasks = useFuzzySearch(mineFiltered, search, ['title', 'notes']);

  // HOUP-185: one batched comment-count query for the whole filtered task
  // list, instead of each TaskRow firing its own head-count query on mount.
  // This screen is FlashList-virtualized (HOUP-206) so per-row queries were
  // already bounded to the visible window, but batching still avoids a
  // per-scroll "Comments" -> "Comments · N" flicker as new rows mount.
  const visibleTaskIds = React.useMemo(() => visibleTasks.map((t) => t.id), [visibleTasks]);
  const taskCommentCounts = useEntityCommentCounts(
    getCurrentSupabaseClient(),
    'household_task_comments',
    'household_task_id',
    visibleTaskIds
  );

  const newSet = new Set(newTaskIds);
  const justAdded = newTaskIds
    .map((id) => visibleTasks.find((t) => t.id === id))
    .filter((t): t is HouseholdTask => !!t && !t.done);
  const bucketable = visibleTasks.filter((t) => !newSet.has(t.id) || t.done);
  // HOUP-245: a just-ticked task stays in its due-date bucket, in its place,
  // until its grace window ends (only Completed hides behind effectiveShowDone).
  const buckets = bucketTasksByDueDate(bucketable, pendingIds);
  // Upcoming reaches the user's window (default 90 days); further-out tasks
  // wait under a collapsed Later group. A search looks across everything.
  const { upcoming, later } = search.trim()
    ? { upcoming: buckets.upcoming, later: [] as HouseholdTask[] }
    : splitUpcomingByWindow(buckets.upcoming, upcomingWindowDays(userSettings));
  // A deep link to a Later task opens the group, same as Completed above.
  const effectiveShowLater = showLater || (!!focusId && later.some((t) => t.id === focusId));
  // "Open" is a global stat (unfiltered by search/Mine); overdue/done reflect
  // the current filtered view — mirrors web's openTaskCount vs. visibleTasks split.
  const openCount = tasks.filter((t) => !t.done).length;
  const overdueCount = buckets.overdue.length;
  const doneCount = buckets.done.length;

  // Out-of-sync template tasks (computed on the full set, not the filtered view).
  // The move-in date is the switch for the whole moving feature: with no date
  // set, or once the move is long past, none of the moving affordances render.
  const movingActive = isMovingActive(moveInDate);

  const outOfSyncCount = findOutOfSyncTasks(tasks, moveInDate).length;

  // Move-in countdown (optional: the screen works fine without a date).
  const countdown = moveInCountdown(moveInDate);

  // HOUP-206: flatten the date buckets (or the person-grouped view) into one
  // FlashList data array — mirrors HOUP-205's documents/index.tsx pattern.
  const flatData = React.useMemo<SectionRow<HouseholdTask>[]>(() => {
    const justAddedGroup = {
      header: justAdded.length > 0 ? { label: 'Just added', tone: 'muted' as const, count: justAdded.length } : undefined,
      rows: justAdded,
    };

    if (groupBy === 'person') {
      const newSetForPerson = new Set(newTaskIds);
      const personTasks = visibleTasks.filter(
        (t) => !newSetForPerson.has(t.id) && (effectiveShowDone || !t.done || pendingIds.has(t.id))
      );
      // You first, then the other members in board order, then anyone else,
      // Unassigned last (FLUX-142); open tasks lead each group (core).
      const personGroups = groupTasksByPerson(personTasks, currentUserId, groupMembers.map((m) => m.user_id)).map(({ key, tasks: items }) => {
        const label = key === 'unassigned' ? 'Unassigned' : memberLabel(key, memberProfiles);
        return { header: { label, tone: 'muted' as const, count: items.length, key }, rows: items };
      });

      return flattenGroups<HouseholdTask>([justAddedGroup, ...personGroups], (t) => t.id);
    }

    // Later's header shows even while collapsed (it is the toggle), so it is
    // pushed by hand rather than through flattenGroups, which drops a header
    // whose group has no rows.
    const laterRows: SectionRow<HouseholdTask>[] =
      later.length > 0
        ? [
            { kind: 'group-header', id: LATER_HEADER_ID, label: 'Later', tone: 'muted', count: later.length },
            ...flattenGroups<HouseholdTask>([{ rows: effectiveShowLater ? later : [] }], (t) => t.id),
          ]
        : [];

    return [
      ...flattenGroups<HouseholdTask>(
        [
          justAddedGroup,
          { header: buckets.overdue.length > 0 ? { label: 'Overdue', tone: 'destructive' as const, count: buckets.overdue.length } : undefined, rows: buckets.overdue },
          { header: buckets.thisWeek.length > 0 ? { label: 'This week', tone: 'muted' as const, count: buckets.thisWeek.length } : undefined, rows: buckets.thisWeek },
          { header: upcoming.length > 0 ? { label: 'Upcoming', tone: 'muted' as const, count: upcoming.length } : undefined, rows: upcoming },
        ],
        (t) => t.id
      ),
      ...laterRows,
      ...flattenGroups<HouseholdTask>(
        [{ header: effectiveShowDone && buckets.done.length > 0 ? { label: 'Completed', tone: 'muted' as const, count: buckets.done.length } : undefined, rows: effectiveShowDone ? buckets.done : [] }],
        (t) => t.id
      ),
    ];
  }, [groupBy, visibleTasks, newTaskIds, effectiveShowDone, effectiveShowLater, currentUserId, groupMembers, memberProfiles, justAdded, buckets, upcoming, later, pendingIds]);

  // Deep-link focus (/tasks?focus=<id>): scroll the focused row into view once
  // it's mounted. Index-based (FlashListRef.scrollToIndex) replaces the old
  // measure()+scrollTo() worklet — `viewPosition: 0, viewOffset: -24` reproduces
  // the same "24px below the top edge" landing spot the old math computed.
  React.useEffect(() => {
    if (!focusId) return;
    const timer = setTimeout(() => {
      const index = flatData.findIndex((row) => row.kind === 'row' && row.item.id === focusId);
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0, viewOffset: -24 });
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, storeLoaded]);

  const renderItem = React.useCallback<ListRenderItem<SectionRow<HouseholdTask>>>(
    ({ item, index }) => {
      const prev = index > 0 ? flatData[index - 1] : undefined;
      const spacing = rowSpacingClassName(prev, item, ROW_SPACING);
      if (item.kind === 'group-header' && item.id === LATER_HEADER_ID) {
        const Chevron = effectiveShowLater ? ChevronDown : ChevronRight;
        return (
          <Pressable
            onPress={() => setShowLater(!effectiveShowLater)}
            accessibilityRole="button"
            accessibilityState={{ expanded: effectiveShowLater }}
            accessibilityLabel={effectiveShowLater ? 'Hide later tasks' : 'Show later tasks'}
            hitSlop={8}
            className={cn('flex-row items-center gap-1 self-start', spacing)}
          >
            <Chevron size={12} className="text-muted-foreground" />
            <Text className={cn('cap-inscription text-[10.5px] font-medium uppercase tracking-[0.1em]', TONE_CLASS.muted)}>
              {item.label}
              {typeof item.count === 'number' && <Text className="text-muted-foreground"> ({item.count})</Text>}
            </Text>
          </Pressable>
        );
      }
      if (item.kind === 'group-header') {
        return (
          <Text className={cn('cap-inscription text-[10.5px] font-medium uppercase tracking-[0.1em]', TONE_CLASS[item.tone], spacing)}>
            {item.label}
            {typeof item.count === 'number' && <Text className="text-muted-foreground"> ({item.count})</Text>}
          </Text>
        );
      }
      const task = item.item;
      return (
        <View className={cn(groupFrameClass(item.pos), spacing)}>
          <TaskRow
            task={task}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            currentUserId={currentUserId}
            focused={task.id === focusId}
            onToggleComplete={handleToggleComplete}
            onEdit={(t) => { setEditingTask(t); setModalOpen(true); }}
            onDelete={(t) => { softDeleteRow(t.id); taskDeleteUndo.addAndShow(t); }}
            onSnooze={handleSnooze}
            onReassign={handleReassign}
            onPriorityChange={handlePriorityChange}
            onRecurrenceChange={handleRecurrenceChange}
            onFieldChange={handleFieldChange}
            checklistsById={checklistsMap}
            checklistItemsByChecklistId={checklistItemsMap}
            supabase={getCurrentSupabaseClient()}
            commentCount={taskCommentCounts.counts[task.id] ?? 0}
            onCommentsChanged={taskCommentCounts.refresh}
          />
        </View>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      flatData,
      focusId,
      effectiveShowLater,
      groupMembers,
      memberProfiles,
      currentUserId,
      checklistsMap,
      checklistItemsMap,
      taskCommentCounts.counts,
      taskCommentCounts.refresh,
    ]
  );

  // Stable memoized element (never an inline `() => <Header/>` closure) so the
  // search/quick-add TextInputs inside it never remount and lose focus mid-type.
  const listHeader = React.useMemo(
    () => (
      <TasksListHeader
        openCount={openCount}
        overdueCount={overdueCount}
        doneCount={doneCount}
        hasTasks={tasks.length > 0}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((v) => !v)}
        onOpenActionSheet={() => setActionSheetOpen(true)}
        onAddTask={() => { setEditingTask(undefined); setModalOpen(true); }}
        countdown={countdown}
        countdownDismissed={countdownDismissed}
        onDismissCountdown={dismissCountdown}
        outOfSyncCount={outOfSyncCount}
        isSyncingDates={isSyncingDates}
        onSyncDates={handleSyncDates}
        search={search}
        onSearchChange={setSearch}
        mineOnly={mineOnly}
        onMineOnlyChange={setMineOnly}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        effectiveShowDone={effectiveShowDone}
        onToggleShowDone={() => setShowDone((v) => !v)}
        quickTitle={quickTitle}
        onQuickTitleChange={setQuickTitle}
        onQuickAdd={handleQuickAdd}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      openCount, overdueCount, doneCount, tasks.length, searchOpen, countdown, countdownDismissed,
      outOfSyncCount, isSyncingDates, search, mineOnly, groupBy, effectiveShowDone, quickTitle,
    ]
  );

  const emptyComponent = React.useMemo(
    () => (
      <Card>
        <View className="items-center gap-3 px-4 py-2">
          <Text className="text-center text-body text-muted-foreground">
            {tasks.length > 0
              ? 'No tasks match the current filters.'
              : movingActive
                ? 'No tasks yet. Add one above, or generate the moving checklist to get started.'
                : 'No tasks yet. Add one above.'}
          </Text>
          {tasks.length === 0 && movingActive && (
            <Pressable
              onPress={handleGenerate}
              disabled={isGenerating}
              accessibilityRole="button"
              className="flex-row items-center gap-1.5 rounded-lg border border-border bg-muted px-3.5 py-2"
              style={isGenerating ? { opacity: 0.5 } : undefined}
            >
              <Sparkles size={16} className="text-foreground" />
              <Text className="text-sm text-foreground">{isGenerating ? 'Generating…' : 'Generate moving tasks'}</Text>
            </Pressable>
          )}
        </View>
      </Card>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks.length, isGenerating, movingActive]
  );

  const taskModalCallbacks = createHouseholdTaskModalCallbacks({
    editingTask,
    setModalOpen,
    setEditingTask,
    writeRow,
    softDeleteRow: (taskId) => {
      softDeleteRow(taskId);
      const deleted = tasks.find((t) => t.id === taskId) ?? editingTask;
      if (deleted) taskDeleteUndo.addAndShow(deleted);
    },
    pinNewTask,
  });

  if (cacheLoading || (!storeLoaded && tasks.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
      <FlashList
        ref={listRef}
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyComponent}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 96,
        }}
      />

      <HouseholdTaskModal
        key={editingTask?.id ?? 'new'}
        open={modalOpen}
        task={editingTask}
        groupId={group.id}
        currentUserId={currentUserId}
        groupMembers={groupMembers}
        memberProfiles={memberProfiles}
        // HOUP-191: `key={editingTask?.id ?? 'new'}` remounts the sheet the
        // instant `editingTask` clears — if that happens in the same tick as
        // `setModalOpen(false)` (as it used to on every close path), the
        // remounted instance starts already-closed and the 250ms exit
        // animation never plays; on Save it also let the store write
        // reorder/remove the row while the old sheet was still visible
        // above it. `createHouseholdTaskModalCallbacks` closes immediately
        // (so Cancel/backdrop/drag/back animate as normal) and defers clearing
        // `editingTask` (plus any write) until the exit animation finishes.
        onClose={taskModalCallbacks.onClose}
        onSave={taskModalCallbacks.onSave}
        onDelete={taskModalCallbacks.onDelete}
      />

      <TasksActionSheet
        open={actionSheetOpen}
        onOpenChange={setActionSheetOpen}
        onRefresh={handleRefresh}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        movingActive={movingActive}
      />
    </ScreenBackground>
  );
}
