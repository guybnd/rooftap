// HOUP-120: native task row parity with apps/web/src/app/tasks/task-row.tsx.
// Long-press opens the hold-to-edit quick menu (`TaskQuickMenu`), swipe
// right=complete/left=snooze (Hearth M3), completing settles for a beat
// before collapsing out (`@homeup/ui`'s `useRowExit` — a state-machine port
// of web's hook; the DOM grid-row collapse has no RN equivalent so this
// fades+slides instead of measuring height), title/notes edit inline via
// `EditableText`, assignee shows as a trailing avatar via `AssigneePicker`,
// and reminder-origin tasks show a backlink chip.
//
// HOUP-198: long-press used to be a plain RN `Pressable.onLongPress` wrapped
// around the row and nested inside SwipeActions' Pan `GestureDetector` — that
// combination silently never fires the long-press (RNGH's native Pan
// recognizer claims the touch responder before the Pressable's JS-timer-based
// long-press can complete), which is the actual "hold-to-edit does nothing"
// bug. Long-press now goes through SwipeActions' own `onLongPress`, composed
// via `Gesture.Race` with its Pan gesture so RNGH arbitrates pan-vs-hold
// itself instead of two uncoordinated touch systems.
//
// HOUP-123: Comments + (when linked) Checklist N/M portal chips via
// `PortalChipRow`, each expanding inline via `ListItemBody` (mirrors web's
// showComments/showChecklist toggle state) — Hearth PC1-6 (neutral tone,
// opens in place) and H3 (local meter).
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import * as SecureStore from 'expo-secure-store';
import { AlarmClock, Check, ChevronRight, ListTodo, MessageSquare, Repeat, RotateCcw, Sparkles } from 'lucide-react-native';
import {
  Text,
  AssigneePicker,
  Avatar,
  ChecklistMeter,
  EditableText,
  EntityComments,
  LeadingTile,
  ListItem,
  ListItemBody,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  PortalChipRow,
  SnoozeUndercard,
  SwipeActions,
  TaskChecklistPanel,
  cn,
  haptics,
  toast,
  useHoldFill,
  useRowExit,
  type PortalChipDef,
  type SwipeConfig,
} from '@homeup/ui';
import {
  completion,
  daysBetweenISO,
  feedRowWhen,
  heroItemSectionId,
  parseReminderKey,
  todayISO,
  useAddChecklistToTask,
  useModules,
  repeatValueLabel,
  type Checklist,
  type ChecklistTaskItem,
  type GroupMember,
  type HeroItem,
  type HouseholdTask,
  type ModuleFeatureId,
  type TaskRepeatFields,
} from '@homeup/core';
import { SNOOZE_PRESETS, SnoozeDatePicker, TaskQuickMenu, type QuickMenuMode, type SnoozeDuration } from './task-quick-menu';
import { sectionIconFor } from '@/lib/section-icons';

type Priority = 'low' | 'medium' | 'high';
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

const PRIORITY_META: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
};
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Med', high: 'High' };

// HOUP-144: mirrors apps/web/src/hooks/use-long-press.ts's trackProgress fill —
// a 100ms grace before the fill starts counting up, reaching 1 exactly as the
// 500ms long-press fires. Driven by `useHoldFill` (packages/ui), fed by
// SwipeActions' onHoldStart/onHoldEnd (HOUP-198).
const LONG_PRESS_MS = 500;

// Origin backlink for reminder tasks (FLUX-116 on web). `tracked_item` has no
// mobile destination yet (no warranties route exists under apps/mobile/src/app)
// so it's intentionally omitted — those tasks fall through to no badge.
// Modules: each link needs Tasks and its origin module (module-features.ts);
// the reminder task itself stays.
const REMINDER_ORIGIN: Partial<Record<string, { label: string; route: Href; feature: ModuleFeatureId }>> = {
  cost: { label: 'Costs', route: '/costs' as Href, feature: 'tasks.from-cost' },
  document: { label: 'Documents', route: '/documents' as Href, feature: 'tasks.from-document' },
};

function formatTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const period = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m[2]}${period}`;
}

function dueMeta(dueDate: string): { label: string; className: string } {
  const diff = daysBetweenISO(todayISO(), dueDate);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, className: 'text-destructive' };
  if (diff === 0) return { label: 'Today', className: 'text-warning' };
  if (diff === 1) return { label: 'Tomorrow', className: 'text-foreground' };
  // H6: a weekday inside the coming week, then a short date (mirrors web).
  const date = new Date(`${dueDate}T00:00:00`);
  const label =
    diff > 0 && diff < 7
      ? date.toLocaleDateString('en-US', { weekday: 'short' })
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, className: 'text-muted-foreground' };
}

function absoluteDateLabel(dueDate: string): string {
  const d = new Date(`${dueDate}T00:00:00`);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// HOUP-283: tapping a due date toggles relative<->absolute display, app-wide
// and persisted (mirrors apps/mobile/src/app/(tabs)/tasks/index.tsx's
// COUNTDOWN_DISMISSED_KEY SecureStore pattern). One module-level observable
// (not per-row state) so every mounted TaskRow — the Tasks screen and the
// home agenda both render this same component — reacts together.
type DateDisplayMode = 'relative' | 'absolute';
const TASKS_DATE_DISPLAY_KEY = 'tasks_date_display_mode';
const dateDisplayMode$ = observable<DateDisplayMode>('relative');
let dateDisplayModeLoaded = false;
function ensureDateDisplayModeLoaded() {
  if (dateDisplayModeLoaded) return;
  dateDisplayModeLoaded = true;
  SecureStore.getItemAsync(TASKS_DATE_DISPLAY_KEY).then((stored) => {
    if (stored === 'relative' || stored === 'absolute') dateDisplayMode$.set(stored);
  });
}
function toggleDateDisplayMode() {
  const next: DateDisplayMode = dateDisplayMode$.get() === 'relative' ? 'absolute' : 'relative';
  dateDisplayMode$.set(next);
  void SecureStore.setItemAsync(TASKS_DATE_DISPLAY_KEY, next);
}

// ── Swipe configs (Hearth M3: right=complete/left=snooze) ──────────────────
const DONE_CFG: SwipeConfig = { bg: 'bg-success/15', activeBg: 'bg-success', icon: <Check size={18} className="text-success-foreground" />, label: 'Done' };
const SNOOZE_CFG: SwipeConfig = { bg: 'bg-warning/15', activeBg: 'bg-warning', icon: <AlarmClock size={18} className="text-warning-foreground" />, label: 'Snooze' };
const UNDO_CFG: SwipeConfig = { bg: 'bg-muted-foreground/15', activeBg: 'bg-muted-foreground', icon: <RotateCcw size={18} className="text-background" />, label: 'Undo' };

// HOUP-175: web's inline snooze undercard — same presets as the quick menu,
// plus "Pick date", which opens the custom-date picker instead of snoozing.
const SNOOZE_OPTIONS: { value: SnoozeDuration | 'date'; label: string }[] = [
  ...SNOOZE_PRESETS.map((o) => ({ value: o.dur, label: o.label })),
  { value: 'date', label: 'Pick date' },
];

interface TaskRowProps {
  task: HouseholdTask;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  currentUserId: string | null;
  /** HOUP-121: deep-linked via /tasks?focus=<id> — briefly highlights the row. */
  focused?: boolean;
  onToggleComplete: (task: HouseholdTask) => void;
  onEdit: (task: HouseholdTask) => void;
  onDelete: (task: HouseholdTask) => void;
  onSnooze: (task: HouseholdTask, dur: SnoozeDuration) => void;
  onReassign: (task: HouseholdTask, userId: string | null) => void;
  onPriorityChange: (task: HouseholdTask, priority: Priority) => void;
  onRecurrenceChange: (task: HouseholdTask, repeat: TaskRepeatFields) => void;
  onFieldChange: (task: HouseholdTask, field: 'title' | 'due_date' | 'notes', value: string) => void;
  /** HOUP-123: task.linked_checklist_id → checklist, for the inline "Checklist N/M" chip + panel. */
  checklistsById?: Record<string, Checklist>;
  /** HOUP-123: checklist id → its live items, for the same inline panel. */
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
  /** HOUP-123: Supabase client for the Comments portal chip's read/write. */
  supabase: SupabaseClient;
  /**
   * HOUP-185: this row's comment count, looked up by the owning list from one
   * batched `useEntityCommentCounts` query instead of each row firing its own
   * head-count query on mount.
   */
  commentCount: number;
  /** Re-fetch the list's batched counts (e.g. after this row's expanded Comments panel adds/removes a comment). */
  onCommentsChanged: () => void;
}

export function TaskRow({
  task,
  groupMembers,
  memberProfiles,
  currentUserId,
  focused = false,
  onToggleComplete,
  onEdit,
  onDelete,
  onSnooze,
  onReassign,
  onPriorityChange,
  onRecurrenceChange,
  onFieldChange,
  checklistsById,
  checklistItemsByChecklistId,
  supabase,
  commentCount,
  onCommentsChanged,
}: TaskRowProps) {
  const router = useRouter();
  const priority = (task.priority ?? 'medium') as Priority;
  const due = !task.done && task.due_date ? dueMeta(task.due_date) : null;

  const [quickMenuOpen, setQuickMenuOpen] = React.useState(false);
  const [quickMenuMode, setQuickMenuMode] = React.useState<QuickMenuMode>('main');
  const [showComments, setShowComments] = React.useState(false);
  const [showChecklist, setShowChecklist] = React.useState(false);
  // HOUP-175: swipe-left reveals this inline undercard instead of escalating
  // straight to the quick-menu sheet (mirrors web's SnoozePicker).
  const [showSnooze, setShowSnooze] = React.useState(false);
  const [snoozeDateOpen, setSnoozeDateOpen] = React.useState(false);

  // HOUP-283: load the persisted relative/absolute preference once per app
  // session (idempotent — see `ensureDateDisplayModeLoaded`), then subscribe
  // this row to the shared observable so every row's due date reacts to the
  // toggle no matter which row triggered it.
  React.useEffect(() => {
    ensureDateDisplayModeLoaded();
  }, []);
  const dateDisplayMode = use$(dateDisplayMode$);

  // HOUP-144: arming feedback for the hold-to-edit long-press — ListItem's
  // `holdProgress` renders the pencil fill (packages/ui's HoldFillOverlay).
  const holdFill = useHoldFill(LONG_PRESS_MS);

  const modules = useModules();
  // HOUP-123: the linked checklist (if any) — drives the "Checklist N/M"
  // portal chip and its inline expanding panel (mirrors web's task-row.tsx).
  // Modules: the chip, panel and "Add checklist" need Tasks and Checklists (module-features.ts).
  const checklistsOn = modules.feature('tasks.checklists');
  const checklist = checklistsOn && task.linked_checklist_id ? checklistsById?.[task.linked_checklist_id] : undefined;
  const checklistItems = checklist ? checklistItemsByChecklistId?.[checklist.id] ?? [] : [];
  // Bumped on every open — forces TaskQuickMenu to remount so its internal
  // sub-panel navigation always resets, even re-opening into the same mode.
  const [quickMenuToken, setQuickMenuToken] = React.useState(0);
  const [editingNotes, setEditingNotes] = React.useState(false);

  // HOUP-332: "Add checklist" from the quick menu. The row binds the write
  // itself (useStoreHelpers is subscription-free, so per-row binding is free)
  // rather than threading an onAddChecklist prop from the store-owning screen.
  // `autoFocusChecklistAdd` is a one-shot flag: true only for the panel mount
  // right after creation, cleared at every OTHER place the panel opens/closes
  // so a later re-open never re-steals focus.
  const addChecklistToTask = useAddChecklistToTask(task, currentUserId);
  const [autoFocusChecklistAdd, setAutoFocusChecklistAdd] = React.useState(false);
  const handleAddChecklist = () => {
    const { undo } = addChecklistToTask.addChecklist();
    setShowChecklist(true);
    setAutoFocusChecklistAdd(true);
    toast.message('Checklist added', { duration: 4000, action: { label: 'Undo', onPress: undo } });
  };

  const exit = useRowExit<SnoozeDuration>(
    () => onToggleComplete(task),
    (dur) => onSnooze(task, dur)
  );

  // Real data caught up (or a snooze changed the due date while mid-exit,
  // HOUP-8 parity) — drop the optimistic phase rather than double-fire.
  React.useEffect(() => {
    if (task.done) exit.cancelComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.done]);
  React.useEffect(() => {
    if (exit.phase === 'snoozing') exit.cancelComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.due_date, task.due_time]);

  const reminder = parseReminderKey(task.template_key);
  const origin = reminder ? REMINDER_ORIGIN[reminder.kind] : undefined;
  const reminderOrigin = origin && modules.feature(origin.feature) ? origin : undefined;

  // Comments + (when linked) Checklist portal chips. Portal budget stays ≤3
  // (PC4). PC7: an empty thread prints nothing (it would cost every row a
  // line); the hold menu's Comments row is how the first one gets added
  // (HOUP-283's "a first comment must be reachable"). Mirrors web.
  const portalChips: PortalChipDef[] = [];
  if (commentCount > 0 || showComments) {
    portalChips.push({
      key: 'comments',
      icon: <MessageSquare size={11} className="text-muted-foreground" />,
      label: (
        <Text className="text-caption font-medium text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'Comments'}
        </Text>
      ),
      accessibilityLabel: 'Comments',
      tone: 'neutral',
      onOpen: () => setShowComments((v) => !v),
    });
  }
  if (checklist) {
    const { done: checklistDone, total: checklistTotal } = completion(checklistItems);
    portalChips.push({
      key: 'checklist',
      icon: <ListTodo size={11} className="text-muted-foreground" />,
      label: (
        <View className="flex-row items-center gap-1.5">
          <Text
            className="text-caption font-medium text-muted-foreground"
            style={Platform.OS === 'android' ? { includeFontPadding: false } : undefined}
          >
            Checklist {checklistDone}/{checklistTotal}
          </Text>
          {checklistTotal > 0 && <ChecklistMeter done={checklistDone} total={checklistTotal} />}
        </View>
      ),
      tone: 'neutral',
      onOpen: () => {
        setAutoFocusChecklistAdd(false);
        setShowChecklist((v) => !v);
      },
    });
  }

  const openQuickMenu = (mode: QuickMenuMode = 'main') => {
    haptics.commit();
    setQuickMenuMode(mode);
    setQuickMenuToken((t) => t + 1);
    setQuickMenuOpen(true);
  };

  // A plain JSX value (NOT a nested function component) — declaring a
  // component function inside another component's render body would give
  // React a brand-new component type every render, remounting the whole row
  // (and losing EditableText/animation state) on every re-render of TaskRow.
  const rowContent = (
    <ListItem
      holdProgress={holdFill.progress}
      className={cn(focused && 'bg-primary/10', (task.done || exit.pendingDone) && 'opacity-[0.55]')}
    >
      <ListItemLeading>
        <Pressable
          onPress={() => {
            if (task.done) {
              haptics.select();
              onToggleComplete(task);
            } else if (exit.phase === 'done-settling') {
              haptics.select();
              exit.cancelComplete();
            } else {
              exit.startComplete();
            }
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.done || exit.pendingDone }}
          accessibilityLabel={task.done ? 'Mark as not done' : 'Mark as done'}
          hitSlop={8}
          className={`h-4 w-4 items-center justify-center rounded-full ${task.done || exit.pendingDone ? 'bg-success' : 'border border-border'}`}
        >
          {(task.done || exit.pendingDone) && <Check size={10} className="text-success-foreground" />}
        </Pressable>
      </ListItemLeading>

      <ListItemContent>
        <ListItemTitle>
          <EditableText
            value={task.title}
            onCommit={(v) => v.trim() && onFieldChange(task, 'title', v.trim())}
            triggerClassName="min-w-0"
          >
            <Text
              numberOfLines={1}
              className={task.done ? 'font-medium text-muted-foreground line-through' : 'font-medium text-foreground'}
            >
              {task.title}
            </Text>
          </EditableText>
        </ListItemTitle>

        <ListItemMeta>
          {task.due_date && (
            // HOUP-283: tap toggles relative<->absolute display (persisted,
            // app-wide via `dateDisplayMode$`); editing the date itself moved
            // to long-press -> main menu -> Due (the guided chip/scroll-field
            // picker) since a sticky inline editor had no RN click-outside to
            // dismiss/commit it.
            <Pressable
              onPress={toggleDateDisplayMode}
              accessibilityRole="button"
              accessibilityLabel="Toggle due date display"
              hitSlop={8}
              className="flex-row items-center"
            >
              {/* H2: only the day word takes the status hue; the time stays muted. */}
              <Text className={`text-caption font-medium ${due?.className ?? 'text-muted-foreground'}`}>
                {dateDisplayMode === 'absolute' ? absoluteDateLabel(task.due_date) : due ? due.label : absoluteDateLabel(task.due_date)}
              </Text>
              {task.due_time ? (
                <Text className="font-mono text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {` ${formatTime(task.due_time)}`}
                </Text>
              ) : null}
            </Pressable>
          )}
          {task.recurrence_days != null && (
            <View className="flex-row items-center gap-1">
              <Repeat size={11} className="text-muted-foreground" />
              <Text className="text-caption text-muted-foreground">{repeatValueLabel(task)}</Text>
            </View>
          )}
          <Text className={`text-caption font-medium ${PRIORITY_META[priority]}`}>{PRIORITY_LABEL[priority]}</Text>
          {reminderOrigin ? (
            <Pressable onPress={() => router.push(reminderOrigin.route)} className="flex-row items-center gap-1">
              <ChevronRight size={11} className="text-muted-foreground" />
              <Text className="text-caption text-muted-foreground">from {reminderOrigin.label}</Text>
            </Pressable>
          ) : (
            task.template_key &&
            !reminder && (
              <View className="flex-row items-center gap-1">
                <Sparkles size={11} className="text-muted-foreground" />
                <Text className="text-caption text-muted-foreground">Moving</Text>
              </View>
            )
          )}
        </ListItemMeta>

        {/* Portal line (Hearth PC): comments + (when linked) the checklist are
            the row's "nouns with a destination" — tappable chips opening an
            expandable panel under the row. Both neutral-tone: they open in
            place rather than navigating away (Hearth PC5). */}
        <PortalChipRow chips={portalChips} />

        {(task.notes || editingNotes) && (
          <EditableText
            value={task.notes ?? ''}
            editing={editingNotes}
            onEditingChange={setEditingNotes}
            onCommit={(v) => onFieldChange(task, 'notes', v)}
            multiline
            rows={2}
            placeholder="Add a description…"
          >
            <Text numberOfLines={2} className="text-caption text-muted-foreground">
              {task.notes || 'Add a description…'}
            </Text>
          </EditableText>
        )}
      </ListItemContent>

      <ListItemTrailing>
        <AssigneePicker
          value={task.assigned_to}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          currentUserId={currentUserId}
          onChange={(userId) => onReassign(task, userId || null)}
        />
      </ListItemTrailing>
    </ListItem>
  );

  return (
    <>
      <Animated.View style={exit.animatedStyle}>
        {task.done ? (
          <SwipeActions
            onSwipeRight={() => {
              haptics.select();
              onToggleComplete(task);
            }}
            right={UNDO_CFG}
            onLongPress={() => openQuickMenu('main')}
            onHoldStart={holdFill.start}
            onHoldEnd={holdFill.stop}
          >
            {rowContent}
          </SwipeActions>
        ) : (
          <SwipeActions
            onSwipeRight={exit.startComplete}
            onSwipeLeft={() => setShowSnooze(true)}
            right={DONE_CFG}
            left={SNOOZE_CFG}
            onLongPress={() => openQuickMenu('main')}
            onHoldStart={holdFill.start}
            onHoldEnd={holdFill.stop}
          >
            {rowContent}
          </SwipeActions>
        )}
      </Animated.View>

      {showSnooze && (
        <SnoozeUndercard
          options={SNOOZE_OPTIONS}
          onPick={(dur) => {
            setShowSnooze(false);
            if (dur === 'date') setSnoozeDateOpen(true);
            else exit.startSnooze(dur);
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}
      <SnoozeDatePicker open={snoozeDateOpen} onClose={() => setSnoozeDateOpen(false)} onPick={(dur) => exit.startSnooze(dur)} />

      {showComments && (
        <ListItemBody expanded={showComments}>
          <EntityComments
            table="household_task_comments"
            fkColumn="household_task_id"
            entityId={task.id}
            supabase={supabase}
            currentUserId={currentUserId}
            memberProfiles={memberProfiles}
            onChanged={onCommentsChanged}
          />
        </ListItemBody>
      )}

      {checklist && showChecklist && (
        <ListItemBody expanded={showChecklist}>
          <TaskChecklistPanel
            checklist={checklist}
            items={checklistItems}
            currentUserId={currentUserId}
            onOpenFull={() => router.push(`/checklists/${checklist.id}` as Href)}
            autoFocusAdd={autoFocusChecklistAdd}
          />
        </ListItemBody>
      )}

      <TaskQuickMenu
        key={quickMenuToken}
        open={quickMenuOpen}
        onOpenChange={setQuickMenuOpen}
        initialMode={quickMenuMode}
        task={task}
        groupMembers={groupMembers}
        memberProfiles={memberProfiles}
        onDateChange={(v) => onFieldChange(task, 'due_date', v)}
        onSnooze={(dur) => exit.startSnooze(dur)}
        onPickSnoozeDate={() => setSnoozeDateOpen(true)}
        onRecurrenceChange={(repeat) => onRecurrenceChange(task, repeat)}
        onReassign={(userId) => onReassign(task, userId)}
        onPriorityChange={(p) => onPriorityChange(task, p)}
        onAddDescription={() => setEditingNotes(true)}
        onEdit={() => onEdit(task)}
        onDelete={() => onDelete(task)}
        checklist={checklist}
        checklistItems={checklistItems}
        onAddChecklist={checklistsOn ? handleAddChecklist : undefined}
        onOpenChecklist={() => {
          setAutoFocusChecklistAdd(false);
          setShowChecklist(true);
        }}
        onOpenComments={() => setShowComments(true)}
        commentCount={commentCount}
      />
    </>
  );
}

// HOUP-221: compact hero-dashboard anatomy, ported from web's
// HeroTaskRow (apps/web/src/app/tasks/task-row.tsx:1140-1409) — the Home
// screen's agenda used to render the full `TaskRow` above (checkbox,
// inline title/notes editing, Comments/Checklist portal chips), which is
// the /tasks-page anatomy, not the dashboard's. This row drops the
// checkbox and inline editors in favor of a tinted type-icon square
// (Check+success once done), a "Done · swipe to undo" done-meta,
// and an inline sourceLabel/completionLabel/ChecklistMeter line — but
// reuses the exact same gesture primitives as `TaskRow` (SwipeActions,
// useRowExit, useHoldFill, SnoozeUndercard, TaskQuickMenu, ListItemBody +
// TaskChecklistPanel): same state machine, different anatomy only.
// Hearth v2 (Feed): a hub row leads with its section's identity tile
// (core heroItemSectionId) instead of a type chip; a plain reminder keeps an
// alarm glyph on the Tasks tile so it still reads as a reminder.
function heroRowIcon(item: HeroItem, sectionId: string): typeof Check {
  if (sectionId === 'household') return item.type === 'reminder' ? AlarmClock : ListTodo;
  return sectionIconFor(sectionId);
}

export interface HeroTaskRowProps {
  /** task/reminder hero item — `item.task` must be present. */
  item: HeroItem;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  currentUserId: string | null;
  onToggleComplete: (task: HouseholdTask) => void;
  onEdit: (task: HouseholdTask) => void;
  onDelete: (task: HouseholdTask) => void;
  onSnooze: (task: HouseholdTask, dur: SnoozeDuration) => void;
  onReassign: (task: HouseholdTask, userId: string | null) => void;
  onPriorityChange: (task: HouseholdTask, priority: Priority) => void;
  onRecurrenceChange: (task: HouseholdTask, repeat: TaskRepeatFields) => void;
  onFieldChange: (task: HouseholdTask, field: 'title' | 'due_date' | 'notes', value: string) => void;
  /** FLUX-1565 parity: task.linked_checklist_id → checklist, for the inline expand panel. */
  checklistsById?: Record<string, Checklist>;
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
}

export function HeroTaskRow({
  item,
  groupMembers,
  memberProfiles,
  currentUserId,
  onToggleComplete,
  onEdit,
  onDelete,
  onSnooze,
  onReassign,
  onPriorityChange,
  onRecurrenceChange,
  onFieldChange,
  checklistsById,
  checklistItemsByChecklistId,
}: HeroTaskRowProps) {
  const router = useRouter();
  const task = item.task!;
  const priority = (task.priority ?? 'medium') as Priority;

  const [quickMenuOpen, setQuickMenuOpen] = React.useState(false);
  const [quickMenuMode, setQuickMenuMode] = React.useState<QuickMenuMode>('main');
  const [quickMenuToken, setQuickMenuToken] = React.useState(0);
  const [showChecklist, setShowChecklist] = React.useState(false);
  const [showSnooze, setShowSnooze] = React.useState(false);
  const [snoozeDateOpen, setSnoozeDateOpen] = React.useState(false);

  const holdFill = useHoldFill(LONG_PRESS_MS);
  // Modules: a bill or document reminder shown while Tasks isn't (task-modules.ts).
  // A tap opens its screen (onEdit routes to item.opensAt) and ticking done is
  // its only task action: no hold menu, snooze or assignee picker.
  const opensElsewhere = !!item.opensAt;

  // FLUX-1565: the linked checklist (if any) — drives the row's inline
  // expand/collapse tap behavior (mirrors TaskRow above).
  // Modules: the panel, progress and "Add checklist" need Tasks and Checklists (module-features.ts).
  const checklistsOn = useModules().feature('tasks.checklists');
  const checklist = checklistsOn && task.linked_checklist_id ? checklistsById?.[task.linked_checklist_id] : undefined;
  const checklistItems = checklist ? checklistItemsByChecklistId?.[checklist.id] ?? [] : [];

  // HOUP-332: "Add checklist" from the quick menu — see TaskRow above for the
  // per-row binding rationale and the one-shot autofocus flag's contract.
  const addChecklistToTask = useAddChecklistToTask(task, currentUserId);
  const [autoFocusChecklistAdd, setAutoFocusChecklistAdd] = React.useState(false);
  const handleAddChecklist = () => {
    const { undo } = addChecklistToTask.addChecklist();
    setShowChecklist(true);
    setAutoFocusChecklistAdd(true);
    toast.message('Checklist added', { duration: 4000, action: { label: 'Undo', onPress: undo } });
  };

  const exit = useRowExit<SnoozeDuration>(
    () => onToggleComplete(task),
    (dur) => onSnooze(task, dur)
  );
  const isDone = task.done || exit.pendingDone;

  React.useEffect(() => {
    if (task.done) exit.cancelComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.done]);
  React.useEffect(() => {
    if (exit.phase === 'snoozing') exit.cancelComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.due_date, task.due_time]);

  const openQuickMenu = (mode: QuickMenuMode = 'main') => {
    haptics.commit();
    setQuickMenuMode(mode);
    setQuickMenuToken((t) => t + 1);
    setQuickMenuOpen(true);
  };

  const tileSection = heroItemSectionId(item);
  const Icon = heroRowIcon(item, tileSection);
  // Hearth v2 (Feed): the day header names the day, so the row only adds a
  // time or how late it is (core feedRowWhen); mirrors web's HeroTaskRow.
  const when = feedRowWhen(item, todayISO());

  // Home never un-ticks on a tap, done or mid-beat: a stray tap shouldn't undo
  // a finish. A done row undoes on purpose, by swiping it back, from the hold
  // menu's "Mark not done", or the Done toast's Undo; a tap on it acts as on
  // an open row.
  const handlePress = () => {
    if (opensElsewhere) {
      onEdit(task);
      return;
    }
    // Mirrors TaskRow/web's HeroTaskRow: a linked checklist expands inline;
    // otherwise a tap on an open row is a no-op (swipe-right is the only way
    // to complete it).
    if (checklist) {
      setAutoFocusChecklistAdd(false);
      setShowChecklist((v) => !v);
    }
  };

  const rowContent = (
    <ListItem holdProgress={holdFill.progress} onPress={handlePress} className={cn('gap-3 py-2.5', isDone && 'opacity-[0.55]')}>
      <ListItemLeading className="mt-0">
        <LeadingTile sectionId={tileSection} Icon={isDone ? Check : Icon} />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle className={cn(isDone && 'text-muted-foreground line-through')}>{item.title}</ListItemTitle>
        <ListItemMeta>
          {isDone ? (
            <Text className="text-caption text-muted-foreground">Done · swipe to undo</Text>
          ) : (
            <>
              {when && (
                <Text
                  className={cn('text-caption', when.kind === 'overdue' ? 'text-destructive' : 'font-mono text-muted-foreground')}
                  style={when.kind === 'time' ? { fontVariant: ['tabular-nums'] } : undefined}
                >
                  {when.kind === 'overdue' ? when.text : formatTime(when.time)}
                </Text>
              )}
              <Text className="text-caption text-muted-foreground">{item.sourceLabel}</Text>
              {checklistsOn && item.completionLabel && (
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-data-fragment text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {item.completionLabel}
                  </Text>
                  {item.completionRatio && item.completionRatio.total > 0 && (
                    <ChecklistMeter done={item.completionRatio.done} total={item.completionRatio.total} />
                  )}
                </View>
              )}
              <Text className={cn('text-caption font-medium', PRIORITY_META[priority])}>{PRIORITY_LABEL[priority]}</Text>
            </>
          )}
        </ListItemMeta>
      </ListItemContent>
      <ListItemTrailing>
        {opensElsewhere ? (
          task.assigned_to ? (
            <Avatar userId={task.assigned_to} profiles={memberProfiles} size={22} ringed={task.assigned_to === currentUserId} />
          ) : null
        ) : (
          <AssigneePicker
            value={task.assigned_to}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            currentUserId={currentUserId}
            onChange={(userId) => onReassign(task, userId || null)}
          />
        )}
      </ListItemTrailing>
    </ListItem>
  );

  return (
    <>
      <Animated.View style={exit.animatedStyle}>
        {task.done ? (
          <SwipeActions
            onSwipeRight={() => {
              haptics.select();
              onToggleComplete(task);
            }}
            right={UNDO_CFG}
            onLongPress={opensElsewhere ? undefined : () => openQuickMenu('main')}
            onHoldStart={opensElsewhere ? undefined : holdFill.start}
            onHoldEnd={opensElsewhere ? undefined : holdFill.stop}
          >
            {rowContent}
          </SwipeActions>
        ) : (
          <SwipeActions
            onSwipeRight={exit.startComplete}
            onSwipeLeft={opensElsewhere ? undefined : () => setShowSnooze(true)}
            right={DONE_CFG}
            left={opensElsewhere ? undefined : SNOOZE_CFG}
            onLongPress={opensElsewhere ? undefined : () => openQuickMenu('main')}
            onHoldStart={opensElsewhere ? undefined : holdFill.start}
            onHoldEnd={opensElsewhere ? undefined : holdFill.stop}
          >
            {rowContent}
          </SwipeActions>
        )}
      </Animated.View>

      {showSnooze && (
        <SnoozeUndercard
          options={SNOOZE_OPTIONS}
          onPick={(dur) => {
            setShowSnooze(false);
            if (dur === 'date') setSnoozeDateOpen(true);
            else exit.startSnooze(dur);
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}
      <SnoozeDatePicker open={snoozeDateOpen} onClose={() => setSnoozeDateOpen(false)} onPick={(dur) => exit.startSnooze(dur)} />

      {checklist && showChecklist && (
        <ListItemBody expanded={showChecklist}>
          <TaskChecklistPanel
            checklist={checklist}
            items={checklistItems}
            currentUserId={currentUserId}
            onOpenFull={item.checklistHref ? () => router.push(item.checklistHref as Href) : undefined}
            autoFocusAdd={autoFocusChecklistAdd}
          />
        </ListItemBody>
      )}

      <TaskQuickMenu
        key={quickMenuToken}
        open={quickMenuOpen}
        onOpenChange={setQuickMenuOpen}
        initialMode={quickMenuMode}
        task={task}
        groupMembers={groupMembers}
        memberProfiles={memberProfiles}
        onDateChange={(v) => onFieldChange(task, 'due_date', v)}
        onSnooze={(dur) => exit.startSnooze(dur)}
        onPickSnoozeDate={() => setSnoozeDateOpen(true)}
        onRecurrenceChange={(repeat) => onRecurrenceChange(task, repeat)}
        onReassign={(userId) => onReassign(task, userId)}
        onPriorityChange={(p) => onPriorityChange(task, p)}
        // Hero row has no inline notes editor (unlike TaskRow above) — "Add
        // description" jumps straight to the full edit modal instead, mirroring
        // web's HeroTaskRow (`onAddDescription: () => onEdit(item)`).
        onAddDescription={() => onEdit(task)}
        onEdit={() => onEdit(task)}
        onDelete={() => onDelete(task)}
        onMarkNotDone={() => onToggleComplete(task)}
        checklist={checklist}
        checklistItems={checklistItems}
        onAddChecklist={checklistsOn ? handleAddChecklist : undefined}
        onOpenChecklist={() => {
          setAutoFocusChecklistAdd(false);
          setShowChecklist(true);
        }}
      />
    </>
  );
}
