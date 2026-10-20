// HOUP-120: native port of apps/web/src/app/tasks/task-row.tsx's
// `TaskQuickMenuBody` (+ its sub-panels `DateEditPanel`/`SnoozeMenuPanel`/
// `AssigneeMenuPanel`/`RepeatMenuPanel`/`PriorityMenuPanel`) — the hold-to-edit
// quick menu (Hearth E1-E4). Web's `PopMenu` (anchor/portal + `mobileSheet`)
// has no native counterpart to lean on; this opens as a `BottomSheet` directly
// since native has no portal-positioning problem to solve. The web menu
// deliberately renders the assignee list as flat rows instead of nesting its
// own portaled `AssigneePicker` (portal-in-portal z-index/focus conflicts) —
// irrelevant on native, but this mirrors the same flat-list pattern for
// consistency with the rest of the sub-panels.
import * as React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import {
  AlarmClock,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  ListTodo,
  MessageSquare,
  Pencil,
  Repeat,
  RotateCcw,
  Trash2,
  UserPlus,
  UserRound,
} from 'lucide-react-native';
import { Text, BottomSheet, DateScrollField, MonthDatePicker, haptics } from '@homeup/ui';
import {
  addDaysISO,
  completionLabel,
  daysBetweenISO,
  toISODate,
  todayISO,
  type Checklist,
  type ChecklistTaskItem,
  type GroupMember,
  type HouseholdTask,
  type TaskSnooze,
} from '@homeup/core';

type Priority = 'low' | 'medium' | 'high';
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
export type SnoozeDuration = TaskSnooze;

export const SNOOZE_PRESETS: { dur: SnoozeDuration; label: string }[] = [
  { dur: '1h', label: '1 hour' },
  { dur: '1d', label: '1 day' },
  { dur: '1w', label: '1 week' },
  { dur: '1m', label: '1 month' },
];

/** Custom snooze date: a month grid, seeded on tomorrow; one tap snoozes until that day. */
export function SnoozeDatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (dur: SnoozeDuration) => void;
}) {
  const [y, m, d] = addDaysISO(todayISO(), 1).split('-').map(Number);
  return (
    <MonthDatePicker
      open={open}
      initialDate={new Date(y, m - 1, d)}
      onClose={onClose}
      onSelect={(date) => {
        onClose();
        onPick(toISODate(date) as SnoozeDuration);
      }}
    />
  );
}
export type QuickMenuMode = 'main' | 'date' | 'snooze' | 'assignee' | 'repeat' | 'priority';

const RECURRENCE_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Does not repeat', days: null },
  { label: 'Daily', days: 1 },
  { label: 'Weekly', days: 7 },
  { label: 'Fortnightly', days: 14 },
  { label: 'Monthly', days: 30 },
];

const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Med', high: 'High' };
const PRIORITY_DOT: Record<Priority, string> = { low: 'bg-muted-foreground', medium: 'bg-warning', high: 'bg-destructive' };

function dueLabel(dueDate: string): string {
  const diff = daysBetweenISO(todayISO(), dueDate);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  return profiles[userId]?.name || profiles[userId]?.email || 'Former member';
}

function MenuDivider() {
  return <View className="my-1 h-px bg-border" />;
}

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
  icon,
  label,
  trailing,
  onPress,
  active,
  danger,
}: {
  icon?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      className="flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5"
    >
      <View className="flex-row items-center gap-2.5">
        {icon}
        <Text className={danger ? 'text-body font-medium text-destructive' : 'text-body text-foreground'}>{label}</Text>
      </View>
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

export interface TaskQuickMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump straight into a sub-panel (e.g. a direct tap on the due-date meta badge) instead of the main menu. */
  initialMode?: QuickMenuMode;
  task: HouseholdTask;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  onDateChange: (v: string) => void;
  onSnooze: (dur: SnoozeDuration) => void;
  /** Opens the row's custom snooze-date picker (after this sheet closes). */
  onPickSnoozeDate: () => void;
  onRecurrenceChange: (days: number | null) => void;
  onReassign: (userId: string | null) => void;
  onPriorityChange: (priority: Priority) => void;
  onAddDescription: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Un-ticks a done task. Home's rows pass it, since a tap there never undoes
   *  a finish; omit it and a done task's menu has no such row. */
  onMarkNotDone?: () => void;
  /** HOUP-332: linked checklist (if any) — drives the Checklist row's `Add` / `N/M` value. */
  checklist?: Checklist;
  checklistItems?: ChecklistTaskItem[];
  /** Creates + links a new checklist. Omit (or when the task is done with no
   *  linked list) to hide the row entirely — a done task keeps no create row. */
  onAddChecklist?: () => void;
  /** Expands the inline checklist panel — never navigates away. */
  onOpenChecklist?: () => void;
  /** Opens the row's comment thread in place. With it, the row only shows a
   *  comments chip once there are comments; this row is the way to add one. */
  onOpenComments?: () => void;
  commentCount?: number;
}

export function TaskQuickMenu({
  open,
  onOpenChange,
  initialMode = 'main',
  task,
  groupMembers,
  memberProfiles,
  onDateChange,
  onSnooze,
  onPickSnoozeDate,
  onRecurrenceChange,
  onReassign,
  onPriorityChange,
  onAddDescription,
  onEdit,
  onDelete,
  onMarkNotDone,
  checklist,
  checklistItems,
  onAddChecklist,
  onOpenChecklist,
  onOpenComments,
  commentCount = 0,
}: TaskQuickMenuProps) {
  // NOTE: the caller remounts this component on every open (a `key` that
  // changes each time, mirroring HouseholdTaskModal's `key={task?.id ?? 'new'}`
  // remount-to-reset convention elsewhere in this codebase) — so this
  // initializer alone resets `mode` to the right starting sub-panel per open,
  // with no effect/ref needed to detect the `open` transition.
  const [mode, setMode] = React.useState<QuickMenuMode>(initialMode);
  const priority = (task.priority ?? 'medium') as Priority;
  const close = () => onOpenChange(false);

  // HA: every choice in this menu is a pick, so select().
  const commit = (fn: () => void) => {
    haptics.select();
    fn();
    close();
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      {/* Live preview header — E1: the header states the item. */}
      <View className="flex-row items-center gap-2 border-b border-border px-4 pb-3">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {task.title}
        </Text>
        {task.due_date && <Text className="shrink-0 text-xs text-muted-foreground">{dueLabel(task.due_date)}</Text>}
        <Text className={`shrink-0 text-xs font-medium ${priority === 'high' ? 'text-destructive' : priority === 'medium' ? 'text-warning' : 'text-muted-foreground'}`}>
          {PRIORITY_LABEL[priority]}
        </Text>
      </View>

      <ScrollView className="max-h-96 px-1 py-1">
        {mode === 'main' && (
          <>
            <MenuItem
              icon={<CalendarPlus size={16} className="text-muted-foreground" />}
              label="Due"
              trailing={<PropertyValue>{task.due_date ? dueLabel(task.due_date) : 'None'}</PropertyValue>}
              onPress={() => setMode('date')}
            />
            <MenuItem
              icon={<Repeat size={16} className="text-muted-foreground" />}
              label="Repeat"
              trailing={
                <PropertyValue>
                  {RECURRENCE_OPTIONS.find((o) => (task.recurrence_days ?? null) === o.days)?.label ?? 'Does not repeat'}
                </PropertyValue>
              }
              onPress={() => setMode('repeat')}
            />
            <MenuItem
              icon={<UserRound size={16} className="text-muted-foreground" />}
              label="Assignee"
              trailing={<PropertyValue>{memberLabel(task.assigned_to, memberProfiles)}</PropertyValue>}
              onPress={() => setMode('assignee')}
            />
            <MenuItem
              icon={<Flag size={16} className="text-muted-foreground" />}
              label="Priority"
              trailing={<PropertyValue>{PRIORITY_LABEL[priority]}</PropertyValue>}
              onPress={() => setMode('priority')}
            />
            {/* HOUP-332: an action row like Add description, not a sub-panel —
                the point is one tap. No linked list + not done -> "Add"
                creates and expands the panel. Linked list -> "N / M", tap
                expands the panel in place. Done task with no linked list ->
                row hidden entirely (the first item typed would re-open the
                task via completion sync). */}
            {checklist ? (
              <MenuItem
                icon={<ListTodo size={16} className="text-muted-foreground" />}
                label="Checklist"
                trailing={<PropertyValue>{completionLabel(checklistItems ?? [])}</PropertyValue>}
                onPress={() => {
                  onOpenChecklist?.();
                  close();
                }}
              />
            ) : (
              !task.done &&
              onAddChecklist && (
                <MenuItem
                  icon={<ListTodo size={16} className="text-muted-foreground" />}
                  label="Checklist"
                  trailing={<PropertyValue>Add</PropertyValue>}
                  onPress={() => {
                    onAddChecklist();
                    close();
                  }}
                />
              )
            )}
            {onOpenComments && (
              <MenuItem
                icon={<MessageSquare size={16} className="text-muted-foreground" />}
                label="Comments"
                trailing={<PropertyValue>{commentCount > 0 ? String(commentCount) : 'Add'}</PropertyValue>}
                onPress={() => {
                  onOpenComments();
                  close();
                }}
              />
            )}

            <MenuDivider />

            {!task.notes && (
              <MenuItem
                icon={<Pencil size={16} className="text-muted-foreground" />}
                label="Add description"
                onPress={() => {
                  onAddDescription();
                  close();
                }}
              />
            )}
            {task.done && onMarkNotDone && (
              <MenuItem
                icon={<RotateCcw size={16} className="text-muted-foreground" />}
                label="Mark not done"
                onPress={() => commit(onMarkNotDone)}
              />
            )}
            {!task.done && (
              <MenuItem
                icon={<AlarmClock size={16} className="text-muted-foreground" />}
                label="Snooze"
                onPress={() => setMode('snooze')}
              />
            )}
            <MenuItem
              icon={<Pencil size={16} className="text-muted-foreground" />}
              label="Edit details"
              onPress={() => {
                close();
                setTimeout(onEdit, 0);
              }}
            />

            <MenuDivider />

            <MenuItem
              icon={<Trash2 size={16} className="text-destructive" />}
              label="Delete"
              danger
              onPress={() => {
                // HOUP-191: this was deleting immediately with no confirm —
                // matches the ItemFormSheet footer's centralized confirm
                // (Alert.alert + warn() fired as the dialog appears).
                haptics.warn();
                Alert.alert(`Delete "${task.title}"?`, 'This removes it from the list.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      onDelete();
                      close();
                    },
                  },
                ]);
              }}
            />
          </>
        )}

        {mode === 'date' && (
          <>
            <BackRow label="Due" onPress={() => setMode('main')} />
            <View className="gap-2 px-3 py-2">
              <View className="flex-row flex-wrap gap-1.5">
                {[
                  { label: 'Today', value: todayISO() },
                  { label: 'Tomorrow', value: addDaysISO(todayISO(), 1) },
                  { label: 'Next week', value: addDaysISO(todayISO(), 7) },
                ].map((chip) => {
                  const active = task.due_date === chip.value;
                  return (
                    <Pressable
                      key={chip.label}
                      onPress={() => {
                        haptics.select();
                        onDateChange(chip.value);
                      }}
                      className={`rounded-lg border px-2.5 py-1 ${active ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      <Text className={`text-xs font-medium ${active ? 'text-primary' : 'text-foreground'}`}>{chip.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <DateScrollField
                value={task.due_date ?? ''}
                onChange={onDateChange}
              />
            </View>
          </>
        )}

        {mode === 'snooze' && (
          <>
            <BackRow label="Snooze for" onPress={() => setMode('main')} />
            {SNOOZE_PRESETS.map((o) => (
              <MenuItem
                key={o.dur}
                icon={<AlarmClock size={16} className="text-muted-foreground" />}
                label={o.label}
                onPress={() => commit(() => onSnooze(o.dur))}
              />
            ))}
            <MenuItem
              icon={<CalendarPlus size={16} className="text-muted-foreground" />}
              label="Pick a date"
              onPress={() => {
                haptics.tick();
                close();
                setTimeout(onPickSnoozeDate, 0);
              }}
            />
          </>
        )}

        {mode === 'assignee' && (
          <>
            <BackRow label="Assignee" onPress={() => setMode('main')} />
            <MenuItem
              icon={<UserPlus size={16} className="text-warning" />}
              label="Unassigned"
              active={!task.assigned_to}
              onPress={() => commit(() => onReassign(null))}
            />
            {groupMembers.map((m) => (
              <MenuItem
                key={m.user_id}
                icon={<UserRound size={16} className="text-muted-foreground" />}
                label={memberLabel(m.user_id, memberProfiles)}
                active={task.assigned_to === m.user_id}
                onPress={() => commit(() => onReassign(m.user_id))}
              />
            ))}
          </>
        )}

        {mode === 'repeat' && (
          <>
            <BackRow label="Repeat" onPress={() => setMode('main')} />
            {RECURRENCE_OPTIONS.map((opt) => (
              <MenuItem
                key={opt.label}
                icon={<Repeat size={16} className="text-muted-foreground" />}
                label={opt.label}
                active={(task.recurrence_days ?? null) === opt.days}
                onPress={() => commit(() => onRecurrenceChange(opt.days))}
              />
            ))}
          </>
        )}

        {mode === 'priority' && (
          <>
            <BackRow label="Priority" onPress={() => setMode('main')} />
            {(['low', 'medium', 'high'] as Priority[]).map((p) => (
              <MenuItem
                key={p}
                icon={<View className={`h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[p]}`} />}
                label={PRIORITY_LABEL[p]}
                active={priority === p}
                onPress={() => commit(() => onPriorityChange(p))}
              />
            ))}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
