'use client';

import { HeroLede } from '@/components/ui/hero-lede';
import { LeadingTile } from '@/components/ui/leading-tile';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { use$ } from '@legendapp/state/react';
import { syncState } from '@legendapp/state';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { HouseholdTask, Checklist, ChecklistTaskItem, householdTasks$, checklists$, checklistItems$, useReconnectSync, useStoreHelpers, useStoreLoaded, createPendingActionTracker, usePendingIds, createUndoBatchTracker, useModules, isTaskOwnerEnabled, splitUpcomingByWindow, upcomingWindowDays, bucketTasksByDueDate, compareTasksByDueDateTimeOrder, groupTasksByPerson, moveInCountdown, checklistsById, checklistItemsByChecklistId, type TaskSnooze } from '@homeup/core';
import {
  Plus,
  RotateCw,
  Sparkles,
  CalendarClock,
  AlertTriangle,
  MoreHorizontal,
  CalendarDays,
  Users,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useModuleSettingsSheet } from '@/components/module-settings-sheet';
import { HouseholdTaskModal } from './household-task-modal';
import { TaskRow } from './task-row';
import { ListGroup } from '@/components/ui/list-item';
import { SectionSearchBar } from '@/components/section-search-bar';
import { useFuzzySearch } from '@/hooks/use-fuzzy-search';
import { PopMenu, MenuItem } from '../setup/pop-menu';
import { memberLabel } from '../setup/member-label';
import {
  generateMovingTasks,
  findOutOfSyncTasks,
  syncMovingTaskDates,
  isMovingActive,
  nextOccurrenceISO,
  todayISO,
} from './moving-tasks';
import { HOUSEHOLD_TASKS_CHANGED_EVENT } from '@/hooks/use-overdue-task-count';
import { toastUndoDelete } from '@/lib/undo-toast';
import { useTaskSnoozeUndo } from './use-task-snooze-undo';
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';

// FLUX-60: Household tasks & reminders — generic recurring tasks + moving template
// FLUX-64: Mobile-first UX pass — overflow menus, pill filters, group-by, undo toasts
// FLUX-150: Legend-State local-first migration

type GroupBy = 'date' | 'person';

export default function TasksPage() {
  const { group, groupMembers, memberProfiles, currentUserId, userSettings, loading: cacheLoading } = useDataCache();

  const tasks$ = householdTasks$(group?.id);
  useReconnectSync(tasks$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(tasks$, currentUserId);
  const snoozeWithUndo = useTaskSnoozeUndo(patchRow);

  // FLUX-1558: linked checklists — feeds the inline "Checklist N/M" chip + panel
  // on each TaskRow (mirrors home/page.tsx's checklistByTaskId derivation).
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

  const checklistsMap = useMemo(() => checklistsById(checklists), [checklists]);
  const checklistItemsMap = useMemo(() => checklistItemsByChecklistId(checklistTaskItems), [checklistTaskItems]);

  // Date ascending, all-day before timed, then time, then sort_order (core, shared with the phone).
  const allTasks = use$(() =>
    Object.values(tasks$.get() ?? {})
      .filter((t): t is HouseholdTask => !!t && !t.deleted)
      .sort(compareTasksByDueDateTimeOrder)
  );
  // Modules: bill and document reminders go with Costs and Documents, so one
  // whose module is off leaves the list and its counts (task-modules.ts).
  const tasks = useMemo(() => allTasks.filter((t) => isTaskOwnerEnabled(t, modules.enabled)), [allTasks, modules.enabled]);

  const storeLoaded = useStoreLoaded(tasks$);

  // HOUP-245: tick-off "linger" + delete-undo pill. One tracker instance per
  // screen (module-scope-equivalent via useMemo) — no cross-screen singleton
  // needed since only one screen showing this list is ever mounted at a time.
  const pendingTracker = useMemo(() => createPendingActionTracker(), []);
  const pendingIds = usePendingIds(pendingTracker);
  const undoBatchTracker = useMemo(() => createUndoBatchTracker<HouseholdTask>(() => {}), []);

  const [showDone, setShowDone] = useState(false);
  const [showLater, setShowLater] = useState(false);
  // Hearth §13.7 "Desktop shell": on a wide screen each group (Overdue, This
  // week, Upcoming, Later; or each person) is its own column, Later open.
  const wide = useWideLayout();
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  // Tasks added via quick-add this session — surfaced at the top so a freshly
  // added task is immediately visible/editable instead of sinking into a bucket
  // further down the list. Each pin self-expires after PIN_MS so the task then
  // re-buckets normally (FLUX-142).
  const [newTaskIds, setNewTaskIds] = useState<string[]>([]);
  const pinTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const PIN_MS = 15000;

  // Pin a just-added task to the top, then auto-release it after PIN_MS.
  const pinNewTask = useCallback((id: string) => {
    setNewTaskIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
    const existing = pinTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setNewTaskIds((prev) => prev.filter((x) => x !== id));
      pinTimers.current.delete(id);
    }, PIN_MS);
    pinTimers.current.set(id, timer);
  }, []);

  // Clear any outstanding pin timers on unmount.
  useEffect(() => {
    const timers = pinTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const settings = useModuleSettingsSheet('household');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<HouseholdTask | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // FLUX-193: search collapses to an icon in the header; expands on tap (or when a
  // query is present). Keeps the top section tight.
  const [searchOpen, setSearchOpen] = useState(false);
  // FLUX-193: the move-in countdown is one-time info once you've moved in — let it
  // be dismissed permanently (persisted per move-in date, so a new date re-shows it).
  const [countdownDismissed, setCountdownDismissed] = useState(false);
  // FLUX-116: deep-link target from /tasks?focus=<id> (read client-side to avoid a Suspense boundary).
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    setFocusId(new URLSearchParams(window.location.search).get('focus'));
  }, []);

  const moveInDate = group?.home_move_in_date ?? null;

  useEffect(() => {
    setCountdownDismissed(!!moveInDate && localStorage.getItem('tasks_countdown_dismissed') === moveInDate);
  }, [moveInDate]);

  const dismissCountdown = () => {
    if (moveInDate) localStorage.setItem('tasks_countdown_dismissed', moveInDate);
    setCountdownDismissed(true);
  };

  // Notify the nav overdue badge whenever the open task count changes.
  const openTaskCount = tasks.filter((t) => !t.done).length;
  useEffect(() => {
    window.dispatchEvent(new Event(HOUSEHOLD_TASKS_CHANGED_EVENT));
  }, [openTaskCount]);

  // Auto-dismiss the ephemeral notice.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Complete / un-complete. Writes go through Legend (offline-safe, auto-retry).
  // Completing a recurring task spawns the next occurrence immediately.
  const handleToggleComplete = (task: HouseholdTask) => {
    if (task.done) {
      patchRow(task.id, { done: false, completed_at: null });
      pendingTracker.cancel(task.id);
      return;
    }
    patchRow(task.id, { done: true, completed_at: new Date().toISOString() });
    pendingTracker.schedule(task.id, () => {});
    if (task.recurrence_days && task.recurrence_days > 0) {
      const next = nextOccurrenceISO(task.due_date, task.recurrence_days);
      writeRow({
        id: crypto.randomUUID(),
        group_id: task.group_id,
        title: task.title,
        due_date: next,
        due_time: task.due_time,
        offset_days: null,
        recurrence_days: task.recurrence_days,
        done: false,
        completed_at: null,
        assigned_to: task.assigned_to,
        private: task.private,
        template_key: null,
        notes: task.notes,
        sort_order: task.sort_order,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }
  };

  const handleRequestDelete = (task: HouseholdTask) => {
    softDeleteRow(task.id);
    undoBatchTracker.add(task);
    toastUndoDelete(undoBatchTracker.count(), () => {
      undoBatchTracker.restoreAll().forEach((t) => patchRow(t.id, { deleted: false }));
    });
  };

  // Swipe-left snooze (FLUX-234) — mirrors home/page.tsx's snoozeTask.
  const handleSnooze = (task: HouseholdTask, dur: TaskSnooze) => {
    snoozeWithUndo(task, dur, todayISO());
  };

  // Generate the curated moving template — idempotent (skips template_keys that exist).
  const handleGenerate = async () => {
    if (!group?.id) return;
    setIsGenerating(true);
    try {
      const supabase = createClient();
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
        setNotice('Moving tasks are already up to date.');
      } else if (!moveInDate) {
        setNotice(`Added ${inserted} moving tasks. Set a move-in date in Settings to schedule them.`);
      } else {
        setNotice(`Added ${inserted} moving task${inserted === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      console.error('Failed to generate moving tasks:', error);
      setNotice('Could not generate moving tasks.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Shift pending template tasks to match the current move-in date.
  const handleSyncDates = async () => {
    if (!group?.id || !moveInDate) return;
    setIsSyncing(true);
    try {
      const supabase = createClient();
      const count = await syncMovingTaskDates({ tasks, moveInDate, supabase });
      void syncState(tasks$).sync();
      setNotice(`Updated ${count} moving task date${count === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('Failed to sync task dates:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Quick-add a title-only task; the modal stays for full details.
  const handleQuickAdd = async (title: string) => {
    if (!group?.id) return;
    const id = crypto.randomUUID();
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
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
    pinNewTask(id);
  };

  // Client-side filter (mine only) — applied for display only.
  const mineFiltered = mineOnly
    ? tasks.filter((t) => t.assigned_to && t.assigned_to === currentUserId)
    : tasks;

  // Fuzzy search narrows the already-filtered set, then feeds the grouping below
  // (FLUX-110). Empty query returns mineFiltered unchanged.
  const visibleTasks = useFuzzySearch(mineFiltered, search, ['title', 'notes']);

  // Just-added (this session) float to the top, out of the normal buckets.
  const newSet = new Set(newTaskIds);
  const justAdded = newTaskIds
    .map((id) => visibleTasks.find((t) => t.id === id))
    .filter((t): t is HouseholdTask => !!t);

  // Bucket by due date (timezone-safe string comparison). HOUP-245: a
  // just-completed task lingers in its normal bucket (still visible, checked)
  // until its grace window expires, instead of jumping straight to Completed.
  const today = todayISO();
  const {
    overdue,
    thisWeek,
    upcoming: allUpcoming,
    done,
  } = bucketTasksByDueDate(
    visibleTasks.filter((t) => !newSet.has(t.id)), // just added ones show in "Just added"
    pendingIds,
    today
  );
  // Upcoming reaches the user's window (default 90 days); further-out tasks
  // wait under a collapsed Later group. A search looks across everything.
  const { upcoming, later } = search.trim()
    ? { upcoming: allUpcoming, later: [] as HouseholdTask[] }
    : splitUpcomingByWindow(allUpcoming, upcomingWindowDays(userSettings), today);
  // A deep link to a Later task opens the group so the focused row is on screen.
  const focusIsLater = !!focusId && later.some((t) => t.id === focusId);
  useEffect(() => {
    if (focusIsLater) setShowLater(true);
  }, [focusIsLater]);

  const doneCount = visibleTasks.filter((t) => t.done).length;

  // Out-of-sync template tasks (computed on the full set, not the filtered view).
  // The move-in date is the switch for the whole moving feature: with no date
  // set, or once the move is long past, none of the moving affordances render.
  const movingActive = isMovingActive(moveInDate);

  const outOfSyncCount = findOutOfSyncTasks(tasks, moveInDate).length;

  // Move-in countdown (optional: the page works fine without a date).
  const countdown = moveInCountdown(moveInDate, today);

  const cardProps = {
    groupMembers,
    memberProfiles,
    currentUserId,
    onToggleComplete: handleToggleComplete,
    onUpdate: (updated: HouseholdTask) => writeRow(updated),
    onSnooze: handleSnooze,
    onEdit: (t: HouseholdTask) => {
      setEditingTask(t);
      setIsModalOpen(true);
    },
    onRequestDelete: handleRequestDelete,
    checklistsById: checklistsMap,
    checklistItemsByChecklistId: checklistItemsMap,
  };

  if (cacheLoading || (!storeLoaded && tasks.length === 0)) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  if (!group) {
    return <div className="p-6 text-muted-foreground">No group selected</div>;
  }

  const renderSection = (title: string, items: HouseholdTask[], accent: string) =>
    items.length > 0 && (
      <div key={title}>
        <h2 className={`mb-2 text-xs font-semibold uppercase tracking-[0.1em] ${accent}`}>
          {title} <span className="text-muted-foreground">({items.length})</span>
        </h2>
        <ListGroup>
          {items.map((task) => (
            <TaskRow key={task.id} task={task} focused={task.id === focusId} {...cardProps} />
          ))}
        </ListGroup>
      </div>
    );

  // Group tasks by assignee for the "By person" view.
  const renderPersonView = () => {
    const personTasks = visibleTasks.filter(
      (t) => !newSet.has(t.id) && (showDone || !t.done || pendingIds.has(t.id))
    );
    // You first, then the other members in board order, then anyone else,
    // Unassigned last (FLUX-142). Open tasks lead each group (FLUX-144).
    return groupTasksByPerson(personTasks, currentUserId, groupMembers.map((m) => m.user_id)).map(({ key, tasks: items }) => {
      const label = key === 'unassigned' ? 'Unassigned' : memberLabel(key, memberProfiles);
      return (
        <div key={key}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label} <span className="text-muted-foreground">({items.length})</span>
          </h2>
          <ListGroup>
            {items.map((task) => (
              <TaskRow key={task.id} task={task} focused={task.id === focusId} {...cardProps} />
            ))}
          </ListGroup>
        </div>
      );
    });
  };

  return (
    <div className={cn('space-y-3 p-4 md:p-6 mx-auto', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      {settings.sheet}
      {/* Row 1 — progress summary + actions. FLUX-193: no big "Add Task" button —
          add via the quick-add bar below or the "+" nav; refresh + generate live in
          the ⋯ overflow, search collapses to the icon. */}
      {/* Hearth v2 (Pulse, H1): the open count is the page's Hero lede. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <HeroLede
          value={openTaskCount}
          label="open"
          caption={
            overdue.length > 0 || doneCount > 0 ? (
              <>
                {overdue.length > 0 && <span className="font-medium text-destructive">{overdue.length} overdue</span>}
                {overdue.length > 0 && doneCount > 0 && ' · '}
                {doneCount > 0 && `${doneCount} done`}
              </>
            ) : undefined
          }
        />
        <div className="flex items-center gap-2">
          {tasks.length > 0 && (
            <button
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search tasks"
              aria-pressed={searchOpen || !!search}
              className={`flex items-center justify-center rounded-lg border p-2 transition-colors active:scale-95 ${
                searchOpen || search
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          {/* Overflow — occasional actions (refresh, generate) live here, not the primary row */}
          <PopMenu
            triggerClassName="flex items-center justify-center rounded-lg bg-muted border border-border p-2 text-muted-foreground hover:bg-accent transition-colors"
            triggerLabel="More actions"
            trigger={<MoreHorizontal className="h-4 w-4" />}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<RotateCw className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    void syncState(tasks$).sync();
                  }}
                >
                  Refresh
                </MenuItem>
                {movingActive && (
                  <MenuItem
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    onClick={() => {
                      close();
                      handleGenerate();
                    }}
                  >
                    {isGenerating ? 'Generating…' : 'Generate moving tasks'}
                  </MenuItem>
                )}
                {settings.available && (
                  <MenuItem
                    icon={<SettingsIcon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      close();
                      settings.open();
                    }}
                  >
                    {settings.label}
                  </MenuItem>
                )}
              </>
            )}
          </PopMenu>
        </div>
      </div>

      {/* Countdown header (only when a move-in date is set + not dismissed) */}
      {countdown && !countdownDismissed && (
        // Hearth v2 (H2): a neutral card with the Tasks tile; coral is for controls.
        <div className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card px-4 py-3 shadow-[var(--card-shadow)]">
          <LeadingTile sectionId="household" Icon={CalendarClock} size="md" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{countdown.label}</div>
            <div className="text-xs text-muted-foreground">{countdown.sub}</div>
          </div>
          <button
            onClick={dismissCountdown}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Out-of-sync offer — move-in date changed since template tasks were generated */}
      {outOfSyncCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            {outOfSyncCount} moving task{outOfSyncCount === 1 ? '' : 's'} {outOfSyncCount === 1 ? 'is' : 'are'} dated for a different move-in date.
          </div>
          <button
            onClick={handleSyncDates}
            disabled={isSyncing}
            className="rounded-lg bg-warning/20 border border-warning/40 px-3 py-1.5 text-sm font-medium text-warning hover:bg-warning/30 disabled:opacity-50 transition-colors"
          >
            {isSyncing ? 'Updating…' : 'Update dates'}
          </button>
        </div>
      )}

      {/* Ephemeral notice */}
      {notice && (
        <div className="rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-foreground">
          {notice}
        </div>
      )}

      {/* Search — revealed from the header search icon (or whenever a query is active) */}
      {tasks.length > 0 && (searchOpen || search) && (
        <SectionSearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search tasks…"
          className="max-w-none"
          autoFocus
        />
      )}

      {/* Filters + grouping */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* All / Mine segmented control */}
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <button
            onClick={() => setMineOnly(false)}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${!mineOnly ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            All
          </button>
          <button
            onClick={() => setMineOnly(true)}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mineOnly ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Mine
          </button>
        </div>

        {/* Group-by segmented control */}
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <button
            onClick={() => setGroupBy('date')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${groupBy === 'date' ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Date
          </button>
          <button
            onClick={() => setGroupBy('person')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${groupBy === 'person' ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Users className="h-3.5 w-3.5" /> Person
          </button>
        </div>

        {/* Completed toggle chip */}
        <button
          onClick={() => setShowDone((v) => !v)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors active:scale-[0.97] ${
            showDone
              ? 'bg-success/15 text-success border-success/30'
              : 'bg-muted text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          Completed
        </button>
      </div>

      {/* Quick-add */}
      <div className={cn(wide && 'max-w-2xl')}>
        <QuickAddTask onAdd={handleQuickAdd} />
      </div>

      {/* Sections */}
      {visibleTasks.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 p-10 text-center space-y-3">
          <p className="text-muted-foreground">
            {tasks.length > 0
              ? 'No tasks match the current filters.'
              : movingActive
                ? 'No tasks yet. Add one above, or generate the moving checklist to get started.'
                : 'No tasks yet. Add one above.'}
          </p>
          {tasks.length === 0 && movingActive && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted border border-border px-3.5 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {isGenerating ? 'Generating…' : 'Generate moving tasks'}
            </button>
          )}
        </div>
      ) : groupBy === 'person' ? (
        <div className={wide ? 'grid grid-cols-2 items-start gap-5 xl:grid-cols-3' : 'space-y-5'}>
          {renderSection('Just added', justAdded, 'text-primary')}
          {renderPersonView()}
        </div>
      ) : (
        <div className={wide ? 'grid grid-cols-2 items-start gap-5 xl:grid-cols-3' : 'space-y-5'}>
          {/* H2: only Overdue is a status; the other headers stay muted. */}
          {renderSection('Just added', justAdded, 'text-muted-foreground')}
          {renderSection('Overdue', overdue, 'text-destructive')}
          {renderSection('This week', thisWeek, 'text-muted-foreground')}
          {renderSection('Upcoming', upcoming, 'text-muted-foreground')}
          {later.length > 0 && (
            <div>
              {wide ? (
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Later <span className="text-muted-foreground">({later.length})</span>
                </h2>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLater((v) => !v)}
                  aria-expanded={showLater}
                  className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                >
                  {showLater ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Later <span className="text-muted-foreground">({later.length})</span>
                </button>
              )}
              {(showLater || wide) && (
                <ListGroup>
                  {later.map((task) => (
                    <TaskRow key={task.id} task={task} focused={task.id === focusId} {...cardProps} />
                  ))}
                </ListGroup>
              )}
            </div>
          )}
          {showDone && renderSection('Completed', done, 'text-success')}
        </div>
      )}

      {/* Modal */}
      <HouseholdTaskModal
        key={editingTask?.id ?? 'new'}
        isOpen={isModalOpen}
        task={editingTask}
        groupId={group.id}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTask(undefined);
        }}
        onSave={(task) => {
          writeRow(task);
          setIsModalOpen(false);
          setEditingTask(undefined);
        }}
        onDelete={(taskId) => {
          softDeleteRow(taskId);
          if (editingTask) {
            undoBatchTracker.add(editingTask);
            toastUndoDelete(undoBatchTracker.count(), () => {
              undoBatchTracker.restoreAll().forEach((t) => patchRow(t.id, { deleted: false }));
            });
          }
          setIsModalOpen(false);
          setEditingTask(undefined);
        }}
      />
    </div>
  );
}

// Inline title-only quick-add. Mirrors the Setup page's QuickAddCard so both
// sections feel the same to add to. Stays focused after add for fast entry.
function QuickAddTask({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onAdd(trimmed);
      setTitle('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 focus-within:border-ring transition-colors">
      <Plus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Add a task…"
        disabled={saving}
        className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
      />
      {title.trim() && (
        <button
          onClick={submit}
          disabled={saving}
          className="text-xs font-medium text-primary hover:text-primary/80 flex-shrink-0 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      )}
    </div>
  );
}
