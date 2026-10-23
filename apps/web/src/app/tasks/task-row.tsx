'use client';

// FLUX-234: the shared task row. Hold-to-edit and swipe (right = done/undo,
// left = Snooze) gesture wiring — previously duplicated (Tasks had hold-only,
// the Today hero had swipe+hold with its own private SnoozePicker) — now lives
// once, here, behind two layouts:
//   - `TaskRow` ("full"): the Tasks list row — checkbox, inline-editable
//     title/due-date/notes, assignee picker, comments toggle, overflow menu.
//   - `HeroTaskRow` ("compact"): the Today-hero dashboard row — type icon,
//     avatar, checklist/calendar shortcuts. Today-hero's inert (appointment/
//     calendar) rows never gesture at all, so they stay inline in
//     today-hero.tsx rather than routing through here.

import { useRef, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { feedRowWhen, heroItemSectionId, parseReminderKey, useEntityCommentCount, useAddChecklistToTask, useModules, recurrenceLabel, type ModuleFeatureId } from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { sectionIconFor } from '@/lib/section-icons';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { EditableText } from '@/components/ui/editable-text';
import {
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  ListItemBody,
} from '@/components/ui/list-item';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import { Repeat, CalendarClock, Sparkles, MessageSquare, Check, ListTodo, AlarmClock, RotateCcw } from 'lucide-react';
import type { GroupMember, HouseholdTask, Checklist, ChecklistTaskItem, RowMenu } from '@homeup/core';
import { useRowContextMenu, withRowMenu } from '@/components/ui/row-context-menu';
import { todayISO, addDaysISO } from './moving-tasks';
import { EntityComments } from '@/components/entity-comments';
import { TaskChecklistPanel } from './task-checklist-panel';
import { completion } from '@homeup/core';
import { AssigneePicker } from '../setup/assignee-picker';
import { memberLabel } from '../setup/member-label';
import { PopMenu } from '../setup/pop-menu';
import { SwipeActions, type SwipeConfig } from '@/components/ui/swipe-actions';
import { useLongPress as useSharedLongPress, HOLD_FILL_DELAY_MS } from '@/hooks/use-long-press';
import { AvatarBubble, formatTime12h, stopNav, type HeroItem } from '../home/hub-shared';
import { success } from '@/lib/haptics';
import { toastUndoAction } from '@/lib/undo-toast';
import { TaskQuickMenuBody, dueMeta, RECURRENCE_OPTIONS, PRIORITY_LABEL, SNOOZE_PRESETS, SnoozeDateInput, type Priority, type MemberProfiles, type SnoozeDuration } from './task-quick-menu';
export type { SnoozeDuration } from './task-quick-menu';

// ── Shared swipe configs — right = done/undo, left = Snooze. Both layouts
//    swipe the same way, so one set of configs backs both. ────────────────────
const DONE_CFG: SwipeConfig = {
  bg: 'bg-success/70',
  activeBg: 'bg-success',
  icon: <Check className="h-5 w-5 text-success-foreground" />,
  label: 'Done',
};
const SNOOZE_CFG: SwipeConfig = {
  bg: 'bg-warning/70',
  activeBg: 'bg-warning',
  icon: <AlarmClock className="h-5 w-5 text-warning-foreground" />,
  label: 'Snooze',
};
// Done rows regain a swipe-right→undo affordance alongside tap-to-undo (FLUX-180).
const UNDO_CFG: SwipeConfig = {
  bg: 'bg-muted-foreground/70',
  activeBg: 'bg-muted-foreground',
  icon: <RotateCcw className="h-5 w-5 text-background" />,
  label: 'Undo',
};

// Hearth §8 — Complete/Snooze row-exit choreography, shared by TaskRow and
// HeroTaskRow. Complete: the row settles into its "done" look (success()
// haptic fires right here) and dwells for a beat before its slot collapses —
// long enough to register before it leaves. Snooze: no beat, the row just
// slides out left and fades once a duration is picked. Both exits share the
// --motion-settle duration; only the timing function differs (swift-out vs.
// ease-in) per Hearth's choreography spec.
const COMPLETE_BEAT_MS = 1200;
const ROW_EXIT_MS = 240; // mirrors --motion-settle

type RowExitPhase = 'idle' | 'done-settling' | 'collapsing' | 'snoozing';

function useRowExit(onComplete: () => void, onSnoozed: (dur: SnoozeDuration) => void) {
  const [phase, setPhase] = useState<RowExitPhase>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const startComplete = useCallback(() => {
    setPhase((p) => {
      if (p !== 'idle') return p;
      success();
      timers.current.push(
        setTimeout(() => {
          setPhase('collapsing');
          timers.current.push(setTimeout(onComplete, ROW_EXIT_MS));
        }, COMPLETE_BEAT_MS)
      );
      return 'done-settling';
    });
  }, [onComplete]);

  const cancelComplete = useCallback(() => {
    clearTimers();
    setPhase('idle');
  }, [clearTimers]);

  const startSnooze = useCallback(
    (dur: SnoozeDuration) => {
      setPhase((p) => {
        if (p !== 'idle') return p;
        timers.current.push(setTimeout(() => onSnoozed(dur), ROW_EXIT_MS));
        return 'snoozing';
      });
    },
    [onSnoozed]
  );

  // Row-exit inline style — grid-rows collapse for Complete, slide+fade for
  // Snooze. Both read off the Phase-1 motion tokens; grid-template-rows is the
  // one non-transform/opacity property in the system, a deliberate exception
  // since collapsing a slot's height is the only way siblings visibly "breathe up".
  const exitStyle: React.CSSProperties = {
    display: 'grid',
    // minmax(0, 1fr): a grid item's min width is its content, so without this a
    // long title pushes the row wider than its card and clips the trailing slot.
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateRows: phase === 'collapsing' ? '0fr' : '1fr',
    transform: phase === 'snoozing' ? 'translateX(-100%)' : 'translateX(0)',
    opacity: phase === 'collapsing' || phase === 'snoozing' ? 0 : 1,
    overflow: 'hidden',
    transitionProperty: 'grid-template-rows, transform, opacity',
    transitionDuration: 'var(--motion-settle)',
    transitionTimingFunction: phase === 'snoozing' ? 'var(--motion-ease-in)' : 'var(--motion-ease-out)',
  };

  return { phase, pendingDone: phase === 'done-settling' || phase === 'collapsing', startComplete, cancelComplete, startSnooze, exitStyle };
}

function SnoozePicker({ onPick, onClose }: { onPick: (dur: SnoozeDuration) => void; onClose: () => void }) {
  return (
    <div
      {...stopNav}
      className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-popover px-3 py-2"
    >
      <span className="text-xs font-medium text-warning">Snooze for</span>
      {SNOOZE_PRESETS.map((o) => (
        <button
          key={o.dur}
          onClick={(e) => {
            e.stopPropagation();
            onPick(o.dur);
          }}
          className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
        >
          {o.label}
        </button>
      ))}
      <div className="w-44">
        <SnoozeDateInput onPick={onPick} />
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

// FLUX-198: elements that own their own pointer interaction never start a hold
// (mirrors groceries' NO_HOLD — buttons/inputs/links/the inline editors).
const NO_HOLD = 'button, input, textarea, select, a, label, [data-no-swipe]';

// FLUX-198: thin wrapper over the shared useLongPress that opens the full row's
// overflow menu as a bottom sheet on hold — same pattern as grocery-item-card.tsx.
// Desktop skips the hold entirely (hover-⋯ / right-click into the same menu instead).
export function useRowLongPress(onFire: () => void) {
  const { handlers: shared, consumeClick, progress } = useSharedLongPress(onFire, true, {
    trackProgress: true,
    fillDelayMs: HOLD_FILL_DELAY_MS,
    moveCancelRatio: 0.1,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    shared.onPointerDown(e);
  }, [shared]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    e.preventDefault();
    onFire();
  }, [onFire]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (consumeClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [consumeClick]);

  return {
    progress,
    handlers: { onPointerDown, onContextMenu, onClickCapture },
  };
}

// Origin backlink for reminder tasks (FLUX-116) — where the reminder came from.
// Modules: each link needs Tasks and its origin module (module-features.ts);
// the reminder task itself stays. `tracked_item` has no destination yet (no
// /warranties route exists), so those reminders show no backlink, same as mobile.
const REMINDER_ORIGIN: Partial<Record<string, { label: string; href: string; feature: ModuleFeatureId }>> = {
  cost: { label: 'Costs', href: '/costs', feature: 'tasks.from-cost' },
  document: { label: 'Documents', href: '/documents', feature: 'tasks.from-document' },
};

// Format a wall-clock "HH:MM[:SS]" as a compact 12h label (FLUX-144).
// One time format across rows, the feed and the Now card ("10:00 AM").
function formatTime(time: string): string {
  return formatTime12h(time) || time;
}

// Hearth §3/§6: priority is a tinted meta word, never a filled pill. Reused
// by both the row meta line and the hold-menu preview (`previewContent`).
const PRIORITY_META: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
};

// Hearth §13.7 "Row menu": the right-click menu for a task, from the same
// values and callbacks the hold sheet (TaskQuickMenuBody) gets, so the two
// never offer different things. "Pick a date" hands over to the full sheet.
interface TaskRowMenuInput {
  title: string;
  isDone: boolean;
  dueDate: string | null;
  recurrenceDays: number | null;
  assignedTo: string | null;
  priority: Priority;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  commentCount: number;
  hasChecklist: boolean;
  onOpen?: () => void;
  onToggleDone?: () => void;
  onDateChange?: (v: string) => void;
  onPickDate?: () => void;
  onSnooze?: (dur: SnoozeDuration) => void;
  onRecurrenceChange?: (days: number | null) => void;
  onReassign?: (userId: string | null) => void;
  onPriorityChange?: (priority: Priority) => void;
  onAddChecklist?: () => void;
  onOpenChecklist?: () => void;
  onOpenComments?: () => void;
  onAddDescription?: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}

const PRIORITY_SWATCH: Record<Priority, string> = {
  low: 'var(--muted-foreground)',
  medium: 'var(--warning)',
  high: 'var(--destructive)',
};

function taskRowMenu(t: TaskRowMenuInput): RowMenu {
  const today = todayISO();
  const days: { label: string; value: string }[] = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDaysISO(today, 1) },
    { label: 'Next week', value: addDaysISO(today, 7) },
  ];
  const onDate = t.onDateChange;
  const onPick = t.onReassign;
  const onRepeat = t.onRecurrenceChange;
  const onPriority = t.onPriorityChange;
  const onSnooze = t.onSnooze;
  return {
    title: t.title,
    kind: 'Task',
    actions: [
      t.onOpen && { id: 'open', label: 'Open', group: 'open', icon: 'open', run: t.onOpen },
      t.onToggleDone && {
        id: 'done',
        label: t.isDone ? 'Mark not done' : 'Mark done',
        group: 'state',
        icon: t.isDone ? 'undo' : 'done',
        run: t.onToggleDone,
      },
      !t.isDone &&
        onDate && {
          id: 'due',
          label: 'Due',
          group: 'set',
          icon: 'due',
          value: t.dueDate ? dueMeta(t.dueDate).label : 'No date',
          options: [
            ...days.map((d) => ({ id: d.label, label: d.label, checked: t.dueDate === d.value, run: () => onDate(d.value) })),
            { id: 'none', label: 'No date', checked: !t.dueDate, run: () => onDate('') },
            ...(t.onPickDate ? [{ id: 'pick', label: 'Pick a date', run: t.onPickDate }] : []),
          ],
        },
      !t.isDone &&
        onSnooze && {
          id: 'snooze',
          label: 'Snooze',
          group: 'set',
          icon: 'snooze',
          options: SNOOZE_PRESETS.map((o) => ({ id: o.dur, label: o.label, run: () => onSnooze(o.dur) })),
        },
      onRepeat && {
        id: 'repeat',
        label: 'Repeat',
        group: 'set',
        icon: 'repeat',
        value: t.recurrenceDays ? recurrenceLabel(t.recurrenceDays) : undefined,
        options: RECURRENCE_OPTIONS.map((o) => ({
          id: String(o.days),
          label: o.label,
          checked: (t.recurrenceDays ?? null) === o.days,
          run: () => onRepeat(o.days),
        })),
      },
      onPick && {
        id: 'assign',
        label: 'Assign',
        group: 'set',
        icon: 'assign',
        value: t.assignedTo ? memberLabel(t.assignedTo, t.memberProfiles) : undefined,
        options: [
          { id: 'none', label: 'Unassigned', checked: !t.assignedTo, run: () => onPick(null) },
          ...t.groupMembers.map((m) => ({
            id: m.user_id,
            label: memberLabel(m.user_id, t.memberProfiles),
            checked: t.assignedTo === m.user_id,
            run: () => onPick(m.user_id),
          })),
        ],
      },
      onPriority && {
        id: 'priority',
        label: 'Priority',
        group: 'set',
        icon: 'priority',
        value: PRIORITY_LABEL[t.priority],
        options: (['high', 'medium', 'low'] as const).map((p) => ({
          id: p,
          label: p === 'medium' ? 'Medium' : PRIORITY_LABEL[p],
          swatch: PRIORITY_SWATCH[p],
          checked: t.priority === p,
          run: () => onPriority(p),
        })),
      },
      t.hasChecklist
        ? t.onOpenChecklist && { id: 'checklist', label: 'Show checklist', group: 'edit', icon: 'checklist', run: t.onOpenChecklist }
        : !t.isDone && t.onAddChecklist && { id: 'checklist', label: 'Add checklist', group: 'edit', icon: 'checklist', run: t.onAddChecklist },
      t.onOpenComments && {
        id: 'comments',
        label: t.commentCount > 0 ? 'Comments' : 'Add a comment',
        group: 'edit',
        icon: 'comment',
        value: t.commentCount > 0 ? String(t.commentCount) : undefined,
        run: t.onOpenComments,
      },
      t.onAddDescription && { id: 'note', label: 'Add description', group: 'edit', icon: 'note', run: t.onAddDescription },
      { id: 'edit', label: 'Edit details', group: 'edit', icon: 'edit', run: t.onEdit },
      t.onDelete && { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', danger: true, run: t.onDelete },
    ],
  };
}

interface TaskRowProps {
  task: HouseholdTask;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  /** The viewing user — used to highlight their own tasks (FLUX-142). */
  currentUserId?: string | null;
  /** When true, scroll into view + briefly highlight (deep-linked via /tasks?focus=). */
  focused?: boolean;
  onToggleComplete: (task: HouseholdTask) => void;
  onUpdate: (task: HouseholdTask) => void;
  onSnooze: (task: HouseholdTask, dur: SnoozeDuration) => void;
  onEdit: (task: HouseholdTask) => void;
  onRequestDelete: (task: HouseholdTask) => void;
  /** FLUX-1558: task.linked_checklist_id → checklist, for the inline "Checklist N/M" chip + panel. */
  checklistsById?: Record<string, Checklist>;
  /** FLUX-1558: checklist id → its live items, for the same inline panel. */
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
}

// ── Full layout — the Tasks list row ─────────────────────────────────────────
export function TaskRow({
  task,
  groupMembers,
  memberProfiles,
  currentUserId,
  focused = false,
  onToggleComplete,
  onUpdate,
  onSnooze,
  onEdit,
  onRequestDelete,
  checklistsById,
  checklistItemsByChecklistId,
}: TaskRowProps) {
  const [showComments, setShowComments] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const supabase = createClient();
  const commentCount = useEntityCommentCount(supabase, {
    table: 'household_task_comments',
    fkColumn: 'household_task_id',
    entityId: task.id,
  });
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const modules = useModules();
  const reminder = parseReminderKey(task.template_key);
  const origin = reminder ? REMINDER_ORIGIN[reminder.kind] : undefined;
  const reminderOrigin = origin && modules.feature(origin.feature) ? origin : undefined;

  // FLUX-1558: the linked checklist (if any) — drives the "Checklist N/M"
  // portal chip and its inline expanding panel.
  // Modules: the chip, panel and "Add checklist" need Tasks and Checklists (module-features.ts).
  const checklistsOn = modules.feature('tasks.checklists');
  const checklist = checklistsOn && task.linked_checklist_id ? checklistsById?.[task.linked_checklist_id] : undefined;
  const checklistItems = checklist ? checklistItemsByChecklistId?.[checklist.id] ?? [] : [];

  // HOUP-332: "Add checklist" from the quick menu — the row binds the write
  // itself (useStoreHelpers is subscription-free, so per-row binding is free)
  // rather than threading an onAddChecklist prop from the store-owning screen.
  // `autoFocusChecklistAdd` is a one-shot flag: true only for the panel mount
  // right after creation, cleared at every OTHER place the panel opens/closes
  // so a later re-open never re-steals focus.
  const addChecklistToTask = useAddChecklistToTask(task, currentUserId);
  const [autoFocusChecklistAdd, setAutoFocusChecklistAdd] = useState(false);
  const handleAddChecklist = () => {
    const { undo } = addChecklistToTask.addChecklist();
    setShowChecklist(true);
    setAutoFocusChecklistAdd(true);
    toastUndoAction('Checklist added', undo);
  };

  // Deep-link target: scroll into view + brief highlight (FLUX-116).
  useEffect(() => {
    if (focused && rootRef.current) {
      rootRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focused]);

  // Persist a single field; null clears it (for optional date/notes)
  const handleFieldChange = (field: string, value: string) => {
    const payload: Record<string, unknown> = {};
    if (field === 'title') {
      if (!value.trim()) return; // don't allow empty title
      payload.title = value.trim();
    } else if (field === 'due_date') {
      payload.due_date = value || null;
      // Detach from the moving template once the user sets the date by hand —
      // it's now their date, so it should never be re-flagged as "out of sync"
      // with the move-in date (FLUX-142). Only moving-template tasks carry an
      // offset_days; reminder tasks (offset_days null) keep their template_key
      // so their origin backlink survives.
      if (task.template_key && task.offset_days != null) {
        payload.template_key = null;
        payload.offset_days = null;
      }
    } else if (field === 'notes') {
      payload.notes = value.trim() || null;
    }

    // Offline-safe: route through the store (onUpdate → writeRow) instead of a
    // direct Supabase update, which throws offline.
    onUpdate({ ...task, ...payload } as HouseholdTask);
  };

  const handleReassign = (assigned_to: string) => {
    onUpdate({ ...task, assigned_to: assigned_to || null });
  };

  // Change recurrence cadence inline — no need to open the full modal.
  const handleRecurrenceChange = (days: number | null) => {
    onUpdate({ ...task, recurrence_days: days });
  };

  // Hearth §7 (E3): Priority is now a quick-edit property, same shape as
  // recurrence — inline update, no modal round-trip.
  const handlePriorityChange = (nextPriority: Priority) => {
    onUpdate({ ...task, priority: nextPriority });
  };

  const exit = useRowExit(
    () => onToggleComplete(task),
    (dur) => onSnooze(task, dur)
  );

  useEffect(() => {
    // Real data caught up (or was toggled elsewhere) — drop the optimistic flag.
    if (task.done) exit.cancelComplete();
  }, [task.done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // HOUP-8: the snooze patch landed and the task stayed in this list (new
    // due_date/due_time sorted it elsewhere in view) — reset the stuck
    // 'snoozing' phase so the row reappears instead of ghosting as a blank
    // full-height slot. Guarded to the snoozing phase so an ordinary
    // quick-edit date change on an idle row is a no-op.
    if (exit.phase === 'snoozing') exit.cancelComplete();
  }, [task.due_date, task.due_time]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDoneVisual = task.done || exit.pendingDone;

  const due = !isDoneVisual && task.due_date ? dueMeta(task.due_date) : null;

  const longPress = useRowLongPress(() => setHoldMenuOpen(true));
  const priority = task.priority ?? 'medium';
  const rowMenu = useRowContextMenu(() =>
    taskRowMenu({
      title: task.title,
      isDone: task.done,
      dueDate: task.due_date,
      recurrenceDays: task.recurrence_days,
      assignedTo: task.assigned_to,
      priority,
      groupMembers,
      memberProfiles,
      commentCount: commentCount.count,
      hasChecklist: !!checklist,
      onToggleDone: task.done ? () => onToggleComplete(task) : exit.startComplete,
      onDateChange: (v) => handleFieldChange('due_date', v),
      onPickDate: () => setHoldMenuOpen(true),
      onSnooze: exit.startSnooze,
      onRecurrenceChange: handleRecurrenceChange,
      onReassign: (userId) => handleReassign(userId ?? ''),
      onPriorityChange: handlePriorityChange,
      onAddChecklist: checklistsOn ? handleAddChecklist : undefined,
      onOpenChecklist: () => {
        setAutoFocusChecklistAdd(false);
        setShowChecklist(true);
      },
      onOpenComments: () => setShowComments(true),
      onAddDescription: task.notes ? undefined : () => setEditingNotes(true),
      onEdit: () => onEdit(task),
      onDelete: () => onRequestDelete(task),
    })
  );

  // FLUX-1558: Comments + (when linked) Checklist portal chips — both
  // neutral-tone (open in place, Hearth PC5). Portal budget stays ≤3 (PC4).
  // PC7: an empty thread prints nothing (it would cost every row a line);
  // the hold menu's Comments row is how the first one gets added.
  const portalChips: PortalChipDef[] = [];
  if (commentCount.count > 0 || showComments) {
    portalChips.push({
      key: 'comments',
      icon: <MessageSquare className="h-3 w-3" />,
      label:
        commentCount.count > 0
          ? `${commentCount.count} comment${commentCount.count === 1 ? '' : 's'}`
          : 'Comments',
      tone: 'neutral',
      onOpen: () => setShowComments((v) => !v),
    });
  }
  if (checklist) {
    const { done: checklistDone, total: checklistTotal } = completion(checklistItems);
    portalChips.push({
      key: 'checklist',
      icon: <ListTodo className="h-3 w-3" />,
      label: (
        <span className="flex items-center gap-1.5">
          Checklist {checklistDone}/{checklistTotal}
          {checklistTotal > 0 && <ChecklistMeter done={checklistDone} total={checklistTotal} />}
        </span>
      ),
      tone: 'neutral',
      onOpen: () => {
        setAutoFocusChecklistAdd(false);
        setShowChecklist((v) => !v);
      },
    });
  }

  const row = (
    <ListItem
      expanded={showComments || showChecklist}
      holdProgress={longPress.progress}
      {...withRowMenu(longPress.handlers, rowMenu)}
      className={cn(
        'items-start gap-3 py-2.5 pr-3 pl-4 transition-colors select-none [-webkit-touch-callout:none]',
        isDoneVisual && 'opacity-[0.55]',
        // Inset (not outset) so the focus ring stays inside SwipeActions'
        // overflow-hidden clip mask instead of getting cut off at its edges.
        focused && 'ring-2 ring-inset ring-primary/50'
      )}
    >
      {/* Complete checkbox — done rows swap it for a filled check (Hearth §6),
          same footprint so toggling done causes no layout shift. */}
      <ListItemLeading>
        {isDoneVisual ? (
          <button
            type="button"
            onClick={() => (task.done ? onToggleComplete(task) : exit.cancelComplete())}
            className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
            aria-label="Mark as not done"
          >
            <Check className="h-2.5 w-2.5" />
          </button>
        ) : (
          <input
            type="checkbox"
            checked={false}
            onChange={() => exit.startComplete()}
            className="mt-1 h-4 w-4 rounded accent-primary flex-shrink-0 cursor-pointer"
            aria-label="Mark as done"
          />
        )}
      </ListItemLeading>

      {/* Title + meta */}
      <ListItemContent>
        <ListItemTitle>
          <EditableText
            value={task.title}
            onCommit={(v) => handleFieldChange('title', v)}
            hasChanged={(next, prev) => next.trim() !== prev}
            triggerClassName={cn(
              'truncate font-medium hover:text-primary transition-colors',
              isDoneVisual ? 'text-muted-foreground line-through' : 'text-foreground'
            )}
            inputClassName="w-full bg-muted border border-input rounded px-2 py-0.5 text-sm text-foreground"
            triggerTitle="Click to edit"
          >
            {task.title}
          </EditableText>
        </ListItemTitle>

        <ListItemMeta>
          {/* Due date — inline editable; absent dates are added via the ⋯ menu */}
          {(task.due_date || editingDueDate) && (
            <EditableText
              value={task.due_date ?? ''}
              editing={editingDueDate}
              onEditingChange={setEditingDueDate}
              onCommit={(v) => handleFieldChange('due_date', v)}
              type="date"
              triggerClassName={cn(
                'flex items-center gap-1 hover:text-primary transition-colors',
                isDoneVisual ? 'text-muted-foreground/70' : 'text-muted-foreground'
              )}
              inputClassName="bg-muted border border-input rounded px-1.5 py-0.5 text-xs text-foreground"
              triggerTitle="Click to edit date"
            >
              {/* H6: relative day, never the raw ISO date; only the status word
                  takes a hue (H2), not the whole line. */}
              <CalendarClock className="h-3 w-3" />
              {due && <span className={cn('font-medium', due.className)}>{due.label}</span>}
              {task.due_time && <span className="font-mono tabular-nums">{formatTime(task.due_time)}</span>}
            </EditableText>
          )}

          {task.recurrence_days != null && (
            <span className="flex items-center gap-1" title="Repeats">
              <Repeat className="h-3 w-3" />
              {recurrenceLabel(task.recurrence_days)}
            </span>
          )}
          {reminderOrigin ? (
            <Link
              href={reminderOrigin.href}
              className="flex items-center gap-1 text-primary/80 hover:text-primary"
              title={`Reminder from ${reminderOrigin.label}`}
            >
              <CalendarClock className="h-3 w-3" />
              from {reminderOrigin.label}
            </Link>
          ) : task.template_key && !reminder ? (
            <span className="flex items-center gap-1 text-primary/80" title="Generated from the moving template">
              <Sparkles className="h-3 w-3" />
              Moving
            </span>
          ) : null}
          {/* Hearth §6: priority is a tinted meta word, never a filled pill. */}
          <span className={cn('font-medium', PRIORITY_META[priority])}>
            {PRIORITY_LABEL[priority]}
          </span>
        </ListItemMeta>

        {/* Portal line (Hearth PC): comments + (when linked) the checklist are
            the row's "nouns with a destination" — tappable chips opening an
            expandable panel under the row. Both neutral-tone: they open in
            place rather than navigating away (Hearth PC5). */}
        <PortalChipRow chips={portalChips} />

        {/* Notes / description — inline editable; absent notes are added via the ⋯ menu */}
        {(task.notes || editingNotes) && (
          <EditableText
            value={task.notes ?? ''}
            editing={editingNotes}
            onEditingChange={setEditingNotes}
            onCommit={(v) => handleFieldChange('notes', v)}
            multiline
            rows={2}
            placeholder="Add a description…"
            triggerClassName="mt-1 block whitespace-pre-wrap text-xs text-muted-foreground hover:text-foreground transition-colors"
            inputClassName="mt-1 w-full bg-muted border border-input rounded px-2 py-1 text-xs text-foreground placeholder-muted-foreground resize-none"
            triggerTitle="Click to edit description"
          >
            {task.notes}
          </EditableText>
        )}
      </ListItemContent>

      {/* Trailing — assignee avatar only (Hearth §6 tenant matrix: Task/reminder
          trailing = assignee avatar). Comments/overflow moved off the row's
          resting chrome — see the portal chip above and the hold/right-click
          menu below. */}
      <ListItemTrailing>
        <AssigneePicker
          value={task.assigned_to}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          currentUserId={currentUserId}
          onChange={handleReassign}
        />
      </ListItemTrailing>
    </ListItem>
  );

  return (
    <div style={exit.exitStyle}>
    <div ref={rootRef} className="relative min-h-0">
      {/* FLUX-234: swipe right = done/undo, swipe left = Snooze — same gesture
          contract as the Today hero. The checkbox + hold/right-click menu are
          the non-gesture path (FLUX-198 guardrail). */}
      {task.done ? (
        <SwipeActions onSwipeRight={() => onToggleComplete(task)} right={UNDO_CFG}>
          {row}
        </SwipeActions>
      ) : (
        <SwipeActions
          onSwipeRight={exit.startComplete}
          onSwipeLeft={() => setShowSnooze(true)}
          right={DONE_CFG}
          left={SNOOZE_CFG}
        >
          {row}
        </SwipeActions>
      )}
      {showSnooze && (
        <SnoozePicker
          onPick={(dur) => {
            exit.startSnooze(dur);
            setShowSnooze(false);
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}
      {rowMenu.menu}

      {/* Overflow menu — edit/delete + add-detail + recurrence. Hearth §6
          retires the inline ⋯ trigger (verbs live in tap/hold/swipe, not
          resting icons): hold opens this as a bottom sheet on touch, and
          right-click opens it on desktop (both wired via useRowLongPress on
          the row itself). The invisible trigger below only gives the
          floating-panel desktop layout a real anchor rect — mirrors
          HeroTaskRow. FLUX-234: previewContent shows a live title/due/priority
          glance, mirroring groceries. */}
      <PopMenu
        trigger={null}
        triggerLabel="More actions"
        triggerClassName="absolute inset-0 opacity-0 pointer-events-none"
        open={holdMenuOpen}
        onOpenChange={setHoldMenuOpen}
        mobileSheet
        previewContent={
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-popover-foreground">{task.title}</span>
            {task.due_date && (
              <span className="shrink-0 text-xs text-muted-foreground">{dueMeta(task.due_date).label}</span>
            )}
            <span className={cn('shrink-0 text-xs font-medium', PRIORITY_META[priority])}>
              {PRIORITY_LABEL[priority]}
            </span>
          </>
        }
      >
        {(close) => (
          <TaskQuickMenuBody
            open={holdMenuOpen}
            dueDate={task.due_date}
            notes={task.notes}
            recurrenceDays={task.recurrence_days}
            isDone={task.done}
            assignedTo={task.assigned_to}
            priority={priority}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            onDateChange={(v) => handleFieldChange('due_date', v)}
            onAddDescription={() => setEditingNotes(true)}
            onSnooze={(dur) => onSnooze(task, dur)}
            onRecurrenceChange={handleRecurrenceChange}
            onReassign={(userId) => handleReassign(userId ?? '')}
            onPriorityChange={handlePriorityChange}
            onEdit={() => onEdit(task)}
            onDelete={() => onRequestDelete(task)}
            close={close}
            checklist={checklist}
            checklistItems={checklistItems}
            onAddChecklist={checklistsOn ? handleAddChecklist : undefined}
            onOpenChecklist={() => {
              setAutoFocusChecklistAdd(false);
              setShowChecklist(true);
            }}
            onOpenComments={() => setShowComments(true)}
            commentCount={commentCount.count}
          />
        )}
      </PopMenu>

      {/* Comments section (expandable) */}
      {showComments && (
        <ListItemBody expanded={showComments}>
          <EntityComments
            table="household_task_comments"
            fkColumn="household_task_id"
            entityId={task.id}
            onChanged={commentCount.refresh}
          />
        </ListItemBody>
      )}

      {/* Checklist section (expandable) — FLUX-1558 */}
      {checklist && showChecklist && (
        <ListItemBody expanded={showChecklist}>
          <TaskChecklistPanel
            checklist={checklist}
            items={checklistItems}
            currentUserId={currentUserId}
            autoFocusAdd={autoFocusChecklistAdd}
          />
        </ListItemBody>
      )}
    </div>
    </div>
  );
}

// ── Compact layout — the Today-hero dashboard row (mutable task/reminder items
//    only; inert appointment/calendar items stay inline in today-hero.tsx). ────
// Hearth v2 (Feed): a hub row leads with its section's identity tile
// (core heroItemSectionId) instead of a type chip; a plain reminder keeps an
// alarm glyph on the Tasks tile so it still reads as a reminder.
function heroRowIcon(item: HeroItem, sectionId: string): typeof Check {
  if (sectionId === 'household') return item.type === 'reminder' ? AlarmClock : ListTodo;
  return sectionIconFor(sectionId) as typeof Check;
}

// FLUX-270/H3: a checklist's live progress, scoped inline to the row it measures
// (~52px x ~3px) — never edge-to-edge. Success-hued per the color-roles table.
function ChecklistMeter({ done, total }: { done: number; total: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  return (
    <span
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="inline-block h-[3px] w-[52px] shrink-0 overflow-hidden rounded-full bg-muted"
    >
      <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function HeroTaskRow({
  item,
  profiles,
  groupMembers,
  onToggle,
  onSnooze,
  onEdit,
  onUpdate,
  onRequestDelete,
  currentUserId,
  checklistsById,
  checklistItemsByChecklistId,
}: {
  item: HeroItem;
  profiles: MemberProfiles;
  groupMembers: GroupMember[];
  onToggle: (item: HeroItem) => void;
  onSnooze: (item: HeroItem, dur: SnoozeDuration) => void;
  onEdit: (item: HeroItem) => void;
  /** FLUX-239: persist an inline field edit (currently due_date) from the hold
   *  quick-edit menu's date panel. Optional so a caller that hasn't wired it yet
   *  degrades gracefully — the menu's date item just doesn't render. */
  onUpdate?: (item: HeroItem, patch: Partial<HouseholdTask>) => void;
  /** FLUX-245: soft-delete from the quick-edit menu. Optional — same
   *  degrade-gracefully pattern as onUpdate. */
  onRequestDelete?: (item: HeroItem) => void;
  /** Hearth §6 — the viewing user; threaded through to the trailing
   *  AssigneePicker for the "yours" accent ring. Optional so today-hero's
   *  existing call site (which doesn't pass it yet) degrades gracefully to
   *  no ring, same as before. */
  currentUserId?: string | null;
  /** FLUX-1565: task.linked_checklist_id → checklist, for the inline expand
   *  panel (mirrors TaskRow's checklistsById on /tasks). */
  checklistsById?: Record<string, Checklist>;
  /** FLUX-1565: checklist id → its live items, for the same inline panel. */
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
}) {
  const [showSnooze, setShowSnooze] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  // FLUX-1565: the linked checklist (if any) — drives the row's inline
  // expand/collapse tap behavior (mirrors TaskRow, task-row.tsx:757-758).
  // Modules: the panel, progress and "Add checklist" need Tasks and Checklists (module-features.ts).
  const checklistsOn = useModules().feature('tasks.checklists');
  const checklist = checklistsOn && item.task?.linked_checklist_id ? checklistsById?.[item.task.linked_checklist_id] : undefined;
  const checklistItems = checklist ? checklistItemsByChecklistId?.[checklist.id] ?? [] : [];

  // HOUP-332: "Add checklist" from the quick menu. `item.task` is always
  // present here — this component only renders for task/reminder hero items
  // (today-hero.tsx's `inert` branch handles appointment/calendar rows
  // itself) — mirroring the non-null assertion the mobile HeroTaskRow uses.
  // `autoFocusChecklistAdd` is a one-shot flag — see TaskRow above.
  const addChecklistToTask = useAddChecklistToTask(item.task!, currentUserId);
  const [autoFocusChecklistAdd, setAutoFocusChecklistAdd] = useState(false);
  const handleAddChecklist = () => {
    const { undo } = addChecklistToTask.addChecklist();
    setShowChecklist(true);
    setAutoFocusChecklistAdd(true);
    toastUndoAction('Checklist added', undo);
  };
  // FLUX-239: hold now opens the same quick-edit PopMenu the /tasks list uses,
  // instead of jumping straight to the full edit modal (hero/list parity).
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  // Modules: a bill or document reminder shown while Tasks isn't (task-modules.ts).
  // A tap opens its screen (onEdit routes to item.opensAt) and ticking done is
  // its only task action: no hold menu, snooze or assignee picker.
  const opensElsewhere = !!item.opensAt;
  // Hearth §8: marking done settles the row into its done look, dwells for a
  // beat, then collapses its slot (today-hero.tsx's compareHeroItems sorts it
  // away the moment `item.done` flips) — see useRowExit above.
  const exit = useRowExit(
    () => onToggle(item),
    (dur) => onSnooze(item, dur)
  );
  const isDone = item.done || exit.pendingDone;

  useEffect(() => {
    // Real data caught up (or was toggled elsewhere) — drop the optimistic flag.
    if (item.done) exit.cancelComplete();
  }, [item.done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // HOUP-8: same reset as TaskRow above — a 1h snooze on Home keeps the
    // task inside Today's range, so this row stays mounted post-snooze and
    // must drop the stuck 'snoozing' phase to reappear in its new slot.
    if (exit.phase === 'snoozing') exit.cancelComplete();
  }, [item.dueDate, item.dueTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // FLUX-180: only OPEN rows arm the "loading into edit" fill (progress + grace +
  // 10%-of-width both-axis cancel). Done rows keep the plain long-press.
  const showHold = !isDone && !opensElsewhere;
  const { handlers, consumeClick, progress } = useLongPressCompact(
    () => setHoldMenuOpen(true),
    !opensElsewhere,
    showHold
      ? { trackProgress: true, fillDelayMs: HOLD_FILL_DELAY_MS, moveCancelRatio: 0.1 }
      : {},
  );

  const task = item.task;
  const rowMenu = useRowContextMenu(() =>
    taskRowMenu({
      title: item.title,
      isDone: item.done,
      dueDate: item.dueDate,
      recurrenceDays: task?.recurrence_days ?? null,
      assignedTo: item.assignedTo,
      priority: task?.priority ?? 'medium',
      groupMembers,
      memberProfiles: profiles,
      commentCount: 0,
      hasChecklist: !!checklist,
      // A reminder for a module Tasks can't show opens its own screen.
      onOpen: opensElsewhere ? () => onEdit(item) : undefined,
      onToggleDone: item.done ? () => onToggle(item) : exit.startComplete,
      onDateChange: !opensElsewhere && onUpdate ? (v) => onUpdate(item, { due_date: v || null }) : undefined,
      onPickDate: opensElsewhere ? undefined : () => setHoldMenuOpen(true),
      onSnooze: opensElsewhere ? undefined : exit.startSnooze,
      onRecurrenceChange: onUpdate && task && !opensElsewhere ? (days) => onUpdate(item, { recurrence_days: days }) : undefined,
      onReassign: onUpdate && task && !opensElsewhere ? (userId) => onUpdate(item, { assigned_to: userId || null }) : undefined,
      onPriorityChange: onUpdate && task && !opensElsewhere ? (p) => onUpdate(item, { priority: p }) : undefined,
      onAddChecklist: checklistsOn && !opensElsewhere ? handleAddChecklist : undefined,
      onOpenChecklist: () => {
        setAutoFocusChecklistAdd(false);
        setShowChecklist(true);
      },
      onEdit: () => onEdit(item),
      onDelete: onRequestDelete && task && !opensElsewhere ? () => onRequestDelete(item) : undefined,
    })
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // never navigate the enclosing tile
    if (consumeClick()) return; // long-press already opened the quick-edit menu
    // FLUX-246: tap-to-dismiss removed — swipe-right is the only way to mark an
    // open row done (Hold still opens the quick-edit sheet). Home never
    // un-ticks on a tap either: a stray tap shouldn't undo a finish. A done
    // row undoes on purpose, by swiping it back, from the hold menu's "Mark
    // not done", or the Done toast's Undo; a tap on it acts as on an open row.
    if (opensElsewhere) {
      onEdit(item);
      return;
    }
    // Hearth §6 tenant matrix: the checklist meter is not a portal chip — it
    // opens with the row (retires the separate resting "Open" pill). FLUX-1565:
    // expands the checklist inline instead of navigating away. A tap on an open
    // row with no linked checklist stays a no-op.
    if (checklist) {
      setAutoFocusChecklistAdd(false);
      setShowChecklist((v) => !v);
    }
  };

  const tileSection = heroItemSectionId(item);
  const Icon = heroRowIcon(item, tileSection);

  // Hearth v2 (Feed): the day header names the day, so the row only adds a
  // time or how late it is (core feedRowWhen).
  const when = feedRowWhen(item, todayISO());

  const row = (
    <ListItem
      {...withRowMenu(handlers, rowMenu)}
      onClick={handleClick}
      expanded={showChecklist}
      holdProgress={showHold ? progress : undefined}
      className={cn(
        // FLUX-239: an explicit transition-property (not the base `transition-colors`,
        // which doesn't cover opacity) so the done dim/fade actually animates instead
        // of snapping in the same frame the row reorders to the bottom.
        'gap-3 py-2.5 cursor-pointer select-none [-webkit-touch-callout:none] transition-[background-color,opacity] duration-[var(--motion-base)] ease-[var(--motion-ease-out)]',
        isDone && 'opacity-[0.55]'
      )}
    >
      <ListItemLeading>
        <LeadingTile sectionId={tileSection} Icon={isDone ? Check : Icon} />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle className={cn(isDone && 'text-muted-foreground line-through')}>
          <span className="min-w-0 truncate">{item.title}</span>
        </ListItemTitle>
        <ListItemMeta>
          {isDone ? (
            <span>Done · swipe to undo</span>
          ) : (
            <>
              {when && (
                <>
                  <span className={when.kind === 'overdue' ? 'text-destructive' : 'font-mono tabular-nums'}>
                    {when.kind === 'overdue' ? when.text : formatTime12h(when.time)}
                  </span>
                  <span>·</span>
                </>
              )}
              <span>{item.sourceLabel}</span>
              {checklistsOn && item.completionLabel && (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{item.completionLabel}</span>
                  {item.completionRatio && item.completionRatio.total > 0 && (
                    <ChecklistMeter done={item.completionRatio.done} total={item.completionRatio.total} />
                  )}
                </>
              )}
              {item.task && (
                <>
                  <span>·</span>
                  <span className={cn('font-medium', PRIORITY_META[item.task.priority ?? 'medium'])}>
                    {PRIORITY_LABEL[item.task.priority ?? 'medium']}
                  </span>
                </>
              )}
            </>
          )}
        </ListItemMeta>
      </ListItemContent>
      <ListItemTrailing>
        {opensElsewhere ? (
          item.assignedTo ? <AvatarBubble userId={item.assignedTo} profiles={profiles} size={22} /> : null
        ) : onUpdate ? (
          <span {...stopNav} data-no-swipe>
            <AssigneePicker
              value={item.assignedTo}
              groupMembers={groupMembers}
              memberProfiles={profiles}
              currentUserId={currentUserId}
              onChange={(uid) => onUpdate(item, { assigned_to: uid || null })}
            />
          </span>
        ) : (
          <AvatarBubble userId={item.assignedTo} profiles={profiles} size={22} />
        )}
      </ListItemTrailing>
    </ListItem>
  );

  return (
    <div style={exit.exitStyle}>
    <div className="relative min-h-0">
      {isDone ? (
        // FLUX-180: done rows undo on swipe-right (Home has no tap-to-undo);
        // no swipe-left (snooze) on a done task.
        <SwipeActions onSwipeRight={() => onToggle(item)} right={UNDO_CFG}>
          {row}
        </SwipeActions>
      ) : (
        <SwipeActions
          onSwipeRight={exit.startComplete}
          onSwipeLeft={opensElsewhere ? undefined : () => setShowSnooze(true)}
          right={DONE_CFG}
          left={opensElsewhere ? undefined : SNOOZE_CFG}
        >
          {row}
        </SwipeActions>
      )}
      {showSnooze && (
        <SnoozePicker
          onPick={(dur) => {
            exit.startSnooze(dur);
            setShowSnooze(false);
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}
      {rowMenu.menu}

      {/* FLUX-239: hero parity — hold opens this same quick-edit action-sheet the
          /tasks list uses (TaskRow above), instead of jumping straight to the full
          modal. No visible trigger button on this compact row; the invisible
          trigger only gives the floating-panel desktop layout a real anchor rect
          (mirrors recipes/[id]/page.tsx's ingredient hold-menu). */}
      <PopMenu
        open={holdMenuOpen}
        onOpenChange={setHoldMenuOpen}
        mobileSheet
        trigger={null}
        triggerLabel="Task actions"
        triggerClassName="absolute inset-0 opacity-0 pointer-events-none"
        previewContent={
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-popover-foreground">{item.title}</span>
            {item.dueDate && (
              <span className="shrink-0 text-xs text-muted-foreground">{dueMeta(item.dueDate).label}</span>
            )}
            {item.task && (
              <span className={cn('shrink-0 text-xs font-medium', PRIORITY_META[item.task.priority ?? 'medium'])}>
                {PRIORITY_LABEL[item.task.priority ?? 'medium']}
              </span>
            )}
          </>
        }
      >
        {(close) => (
          <TaskQuickMenuBody
            open={holdMenuOpen}
            dueDate={item.dueDate}
            notes={item.task?.notes ?? null}
            recurrenceDays={item.task?.recurrence_days ?? null}
            isDone={isDone}
            assignedTo={item.assignedTo}
            priority={item.task?.priority ?? 'medium'}
            groupMembers={groupMembers}
            memberProfiles={profiles}
            onDateChange={onUpdate ? (v) => onUpdate(item, { due_date: v || null }) : undefined}
            onAddDescription={() => requestAnimationFrame(() => onEdit(item))}
            onSnooze={(dur) => onSnooze(item, dur)}
            onRecurrenceChange={onUpdate && item.task ? (days) => onUpdate(item, { recurrence_days: days }) : undefined}
            onReassign={onUpdate && item.task ? (userId) => onUpdate(item, { assigned_to: userId || null }) : undefined}
            onPriorityChange={onUpdate && item.task ? (p) => onUpdate(item, { priority: p }) : undefined}
            onEdit={() => onEdit(item)}
            onDelete={onRequestDelete && item.task ? () => onRequestDelete(item) : undefined}
            onMarkNotDone={item.done ? () => onToggle(item) : undefined}
            close={close}
            checklist={checklist}
            checklistItems={checklistItems}
            onAddChecklist={checklistsOn ? handleAddChecklist : undefined}
            onOpenChecklist={() => {
              setAutoFocusChecklistAdd(false);
              setShowChecklist(true);
            }}
          />
        )}
      </PopMenu>

      {/* Checklist section (expandable) — FLUX-1565 hero parity with TaskRow */}
      {checklist && showChecklist && (
        <ListItemBody expanded={showChecklist}>
          <TaskChecklistPanel
            checklist={checklist}
            items={checklistItems}
            currentUserId={currentUserId}
            autoFocusAdd={autoFocusChecklistAdd}
          />
        </ListItemBody>
      )}
    </div>
    </div>
  );
}

// Today-hero's rows have no hover-revealed ⋯ menu, so unlike the full layout's
// hold, this one doesn't exclude mouse pointers — hold-to-edit is the only
// affordance for a desktop mouse there too. It DOES still exclude interactive
// targets (the assignee picker button) so a hold on the picker doesn't also
// arm the row's quick-edit sheet — mirrors useRowLongPress, minus the mouse skip.
function useLongPressCompact(onFire: () => void, enabled: boolean, options: Parameters<typeof useSharedLongPress>[2]) {
  const { handlers: shared, consumeClick, progress } = useSharedLongPress(onFire, enabled, options);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    shared.onPointerDown(e);
  }, [shared]);

  // Right-click opens the same menu the hold does (Hearth §13 "Desktop shell").
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!enabled || (e.target as HTMLElement).closest(NO_HOLD)) return;
    e.preventDefault();
    onFire();
  }, [enabled, onFire]);

  return { handlers: { onPointerDown, onContextMenu }, consumeClick, progress };
}
