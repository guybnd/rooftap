'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { completionLabel } from '@homeup/core';
import { cn } from '@/lib/utils';
import { DateScrollField } from '@/components/date-scroll-field';
import { Pencil, Trash2, Repeat, CalendarPlus, MessageSquare, FileText, ListTodo, AlarmClock, RotateCcw, UserRound, ChevronRight, ChevronLeft, Flag } from 'lucide-react';
import type { GroupMember, Checklist, ChecklistTaskItem, TaskSnooze } from '@homeup/core';
import { daysBetweenISO, todayISO, addDaysISO } from './moving-tasks';
import { memberLabel } from '../setup/member-label';
import { MenuItem, MenuLabel, MenuDivider } from '../setup/pop-menu';
import { AvatarBubble, stopNav } from '../home/hub-shared';
import { tick, warn } from '@/lib/haptics';

export type Priority = 'low' | 'medium' | 'high';

export type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export type SnoozeDuration = TaskSnooze;

// ── Snooze picker — reused by both layouts (previously private to today-hero.tsx). ──
export const SNOOZE_PRESETS: { dur: SnoozeDuration; label: string }[] = [
  { dur: '1h', label: '1 hour' },
  { dur: '1d', label: '1 day' },
  { dur: '1w', label: '1 week' },
  { dur: '1m', label: '1 month' },
];

// Custom snooze date: a native date input plus a Set button (same shape as the
// groceries SnoozeMenu), so a half-typed date never commits on its own.
export function SnoozeDateInput({ onPick }: { onPick: (dur: SnoozeDuration) => void }) {
  const [date, setDate] = useState('');
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        aria-label="Snooze until"
        value={date}
        min={addDaysISO(todayISO(), 1)}
        onChange={(e) => setDate(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:border-ring"
      />
      <button
        type="button"
        disabled={!date}
        onClick={(e) => {
          e.stopPropagation();
          onPick(date as SnoozeDuration);
        }}
        className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/70 transition-colors"
      >
        Set
      </button>
    </div>
  );
}

// FLUX-239: real due-date control for the quick-edit menu — Today/Tomorrow/
// Next-week chips + DateScrollField, mirroring household-task-modal.tsx's due-date
// field — reused by both TaskRow and HeroTaskRow's PopMenu so the two menus can't
// drift apart. Replaces the old bare "Add date" item that only flipped an inline
// EditableText and only appeared when there was no date yet.
export function DateEditPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const chips: { label: string; value: string }[] = [
    { label: 'Today', value: todayISO() },
    { label: 'Tomorrow', value: addDaysISO(todayISO(), 1) },
    { label: 'Next week', value: addDaysISO(todayISO(), 7) },
  ];
  return (
    <div {...stopNav} className="px-3.5 py-2">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = value === chip.value;
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => onChange(chip.value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-muted text-muted-foreground hover:bg-accent'
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className="rounded-lg border border-border bg-muted/40 py-1">
        <DateScrollField value={value} onChange={onChange} />
      </div>
    </div>
  );
}

// Recurrence presets, in days. `null` means no recurrence.
export const RECURRENCE_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Does not repeat', days: null },
  { label: 'Daily', days: 1 },
  { label: 'Weekly', days: 7 },
  { label: 'Fortnightly', days: 14 },
  { label: 'Monthly', days: 30 },
];

// Relative due-date hint + colour for a pending task.
export function dueMeta(dueDate: string): { label: string; className: string } {
  const diff = daysBetweenISO(todayISO(), dueDate);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, className: 'text-destructive' };
  if (diff === 0) return { label: 'Today', className: 'text-warning' };
  if (diff === 1) return { label: 'Tomorrow', className: 'text-foreground' };
  // H6: a weekday inside the coming week, then a short date; never raw ISO.
  const date = new Date(`${dueDate}T00:00:00`);
  const label =
    diff > 0 && diff < 7
      ? date.toLocaleDateString('en-US', { weekday: 'short' })
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, className: 'text-muted-foreground' };
}

export const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Med', high: 'High' };

// Small swatch for the Priority sub-panel's option list — same hues as the
// tinted meta word, never a filled pill (Hearth §3/§6).
export const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-muted-foreground',
  medium: 'bg-warning',
  high: 'bg-destructive',
};

// FLUX-245: the shared quick-edit menu body — both TaskRow and HeroTaskRow
// render this so their menus can't drift apart again (FLUX-239 unified only
// the date panel; this extends the same idea to the rest of the menu). Takes
// resolved primitives + normalized callbacks so it works for either caller's
// differing onUpdate shape. Hearth §7 (E3): every sub-panel gets a back row
// (`BackRow` below) in addition to the reset-on-close behaviour — closing the
// menu still resets to 'main', but a sub-panel no longer requires closing the
// whole sheet to return.
export type QuickMenuMode = 'main' | 'date' | 'snooze' | 'assignee' | 'repeat' | 'priority';

// Hearth §7 (E3): every sub-panel opens with a way back to the property list
// without closing the sheet. Local to this file — no `pop-menu.tsx` change.
export function BackRow({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <MenuItem icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={onBack}>
      {label}
    </MenuItem>
  );
}

// Hearth §7 (E2): a property row's current value, right-aligned with a
// chevron — the whole item is readable with zero taps.
export function PropertyValue({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="max-w-[9rem] truncate text-xs font-medium">{children}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
    </span>
  );
}

export interface TaskQuickMenuBodyProps {
  /** Whether the enclosing PopMenu is open — used to reset the sub-panel. */
  open: boolean;
  dueDate: string | null;
  notes: string | null;
  recurrenceDays: number | null;
  isDone: boolean;
  assignedTo: string | null;
  priority: Priority;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  onDateChange?: (v: string) => void;
  onAddDescription?: () => void;
  onSnooze: (dur: SnoozeDuration) => void;
  onRecurrenceChange?: (days: number | null) => void;
  onReassign?: (userId: string | null) => void;
  onPriorityChange?: (priority: Priority) => void;
  onEdit: () => void;
  onDelete?: () => void;
  /** Un-ticks a done task. Home's rows pass it, since a tap there never undoes
   *  a finish; omit it and a done task's menu has no such row. */
  onMarkNotDone?: () => void;
  close: () => void;
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

export function TaskQuickMenuBody({
  open,
  dueDate,
  notes,
  recurrenceDays,
  isDone,
  assignedTo,
  priority,
  groupMembers,
  memberProfiles,
  onDateChange,
  onAddDescription,
  onSnooze,
  onRecurrenceChange,
  onReassign,
  onPriorityChange,
  onEdit,
  onDelete,
  onMarkNotDone,
  close,
  checklist,
  checklistItems,
  onAddChecklist,
  onOpenChecklist,
  onOpenComments,
  commentCount = 0,
}: TaskQuickMenuBodyProps) {
  const [mode, setMode] = useState<QuickMenuMode>('main');

  useEffect(() => {
    if (!open) setMode('main');
  }, [open]);

  if (mode === 'date') {
    return (
      <>
        <BackRow onBack={() => setMode('main')} label="Due date" />
        <DateEditPanel
          value={dueDate ?? ''}
          onChange={(v) => {
            tick();
            onDateChange?.(v);
          }}
        />
      </>
    );
  }
  if (mode === 'snooze') {
    return (
      <>
        <BackRow onBack={() => setMode('main')} label="Snooze for" />
        <SnoozeMenuPanel
          onPick={(dur) => {
            tick();
            onSnooze(dur);
            close();
          }}
        />
      </>
    );
  }
  if (mode === 'assignee') {
    return (
      <>
        <BackRow onBack={() => setMode('main')} label="Assignee" />
        <AssigneeMenuPanel
          value={assignedTo}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          onPick={(userId) => {
            tick();
            onReassign?.(userId);
            close();
          }}
        />
      </>
    );
  }
  if (mode === 'repeat') {
    return (
      <>
        <BackRow onBack={() => setMode('main')} label="Repeat" />
        <RepeatMenuPanel
          value={recurrenceDays}
          onPick={(days) => {
            tick();
            onRecurrenceChange?.(days);
            close();
          }}
        />
      </>
    );
  }
  if (mode === 'priority') {
    return (
      <>
        <BackRow onBack={() => setMode('main')} label="Priority" />
        <PriorityMenuPanel
          value={priority}
          onPick={(p) => {
            tick();
            onPriorityChange?.(p);
            close();
          }}
        />
      </>
    );
  }

  // Hearth §7 (E2): current value for each property row — the whole item is
  // readable without opening a sub-panel.
  const dueValue = dueDate ? dueMeta(dueDate).label : 'None';
  const repeatValue =
    RECURRENCE_OPTIONS.find((opt) => (recurrenceDays ?? null) === opt.days)?.label ?? 'Does not repeat';
  const assigneeValue = assignedTo ? memberLabel(assignedTo, memberProfiles) : 'Unassigned';
  const hasPropertyRows = !!(onDateChange || onRecurrenceChange || onReassign || onPriorityChange);

  return (
    <>
      {/* FLUX-239/Hearth §7 (E2): a real date control (chips + DateScrollField),
          always available — not just when there's no date yet — persisting
          immediately as it's changed. */}
      {onDateChange && (
        <MenuItem
          icon={<CalendarPlus className="h-3.5 w-3.5" />}
          onClick={() => setMode('date')}
          trailing={<PropertyValue>{dueValue}</PropertyValue>}
        >
          Due
        </MenuItem>
      )}
      {onRecurrenceChange && (
        <MenuItem
          icon={<Repeat className="h-3.5 w-3.5" />}
          onClick={() => setMode('repeat')}
          trailing={<PropertyValue>{repeatValue}</PropertyValue>}
        >
          Repeat
        </MenuItem>
      )}
      {onReassign && (
        <MenuItem
          icon={<UserRound className="h-3.5 w-3.5" />}
          onClick={() => setMode('assignee')}
          trailing={<PropertyValue>{assigneeValue}</PropertyValue>}
        >
          Assignee
        </MenuItem>
      )}
      {onPriorityChange && (
        <MenuItem
          icon={<Flag className="h-3.5 w-3.5" />}
          onClick={() => setMode('priority')}
          trailing={<PropertyValue>{PRIORITY_LABEL[priority]}</PropertyValue>}
        >
          Priority
        </MenuItem>
      )}
      {/* HOUP-332: an action row like Add description, not an E3 sub-panel —
          the point is one tap. No linked list + not done -> "Add" creates and
          expands the panel. Linked list -> "N / M", tap expands the panel
          in place. Done task with no linked list -> row hidden entirely (the
          first item typed would re-open the task via completion sync). */}
      {checklist ? (
        <MenuItem
          icon={<ListTodo className="h-3.5 w-3.5" />}
          onClick={() => {
            onOpenChecklist?.();
            close();
          }}
          trailing={<PropertyValue>{completionLabel(checklistItems ?? [])}</PropertyValue>}
        >
          Checklist
        </MenuItem>
      ) : (
        !isDone &&
        onAddChecklist && (
          <MenuItem
            icon={<ListTodo className="h-3.5 w-3.5" />}
            onClick={() => {
              onAddChecklist();
              close();
            }}
            trailing={<PropertyValue>Add</PropertyValue>}
          >
            Checklist
          </MenuItem>
        )
      )}
      {onOpenComments && (
        <MenuItem
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          onClick={() => {
            onOpenComments();
            close();
          }}
          trailing={<PropertyValue>{commentCount > 0 ? commentCount : 'Add'}</PropertyValue>}
        >
          Comments
        </MenuItem>
      )}
      {hasPropertyRows && <MenuDivider />}
      {!notes && onAddDescription && (
        <MenuItem
          icon={<FileText className="h-3.5 w-3.5" />}
          onClick={() => {
            onAddDescription();
            close();
          }}
        >
          Add description
        </MenuItem>
      )}
      {isDone && onMarkNotDone && (
        <MenuItem
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          onClick={() => {
            tick();
            onMarkNotDone();
            close();
          }}
        >
          Mark not done
        </MenuItem>
      )}
      {!isDone && (
        <MenuItem icon={<AlarmClock className="h-3.5 w-3.5" />} onClick={() => setMode('snooze')}>
          Snooze
        </MenuItem>
      )}
      <MenuItem
        icon={<Pencil className="h-3.5 w-3.5" />}
        onClick={() => {
          // FLUX-239: closing this sheet and opening the HouseholdTaskModal
          // sheet in the same tick makes the two base-ui BottomSheet dialogs
          // contend over focus-trap/portal teardown, swallowing the first tap —
          // close first, defer the modal to next frame.
          close();
          requestAnimationFrame(onEdit);
        }}
      >
        Edit details
      </MenuItem>
      {onDelete && (
        <>
          <MenuDivider />
          {/* Hearth §7 (E4): destructive sits alone, its own inset group. This
              menu has no separate confirm dialog before the soft-delete fires,
              so the tap here is the commit point — warn() fires on click. */}
          <MenuItem
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => {
              warn();
              onDelete();
              close();
            }}
          >
            Delete
          </MenuItem>
        </>
      )}
    </>
  );
}

// Inline snooze-duration picker for the quick-edit menu (FLUX-245) — replaces
// the old close-then-undercard-SnoozePicker flow for the menu path only; the
// swipe-left gesture keeps using SnoozePicker as an undercard, unchanged.
export function SnoozeMenuPanel({ onPick }: { onPick: (dur: SnoozeDuration) => void }) {
  return (
    <>
      <MenuLabel>Snooze for</MenuLabel>
      {SNOOZE_PRESETS.map((o) => (
        <MenuItem key={o.dur} icon={<AlarmClock className="h-3.5 w-3.5" />} onClick={() => onPick(o.dur)}>
          {o.label}
        </MenuItem>
      ))}
      <MenuLabel>Until a date</MenuLabel>
      <div className="px-3.5 py-2">
        <SnoozeDateInput onPick={onPick} />
      </div>
    </>
  );
}

// Inline assignee picker for the quick-edit menu (FLUX-245) — renders as plain
// MenuItems rather than the portaled AssigneePicker, since a portal nested
// inside the PopMenu bottom-sheet tangles focus/z-index.
export function AssigneeMenuPanel({
  value,
  groupMembers,
  memberProfiles,
  onPick,
}: {
  value: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  onPick: (userId: string | null) => void;
}) {
  return (
    <>
      <MenuLabel>Assignee</MenuLabel>
      <MenuItem
        icon={<AvatarBubble userId={null} profiles={memberProfiles} size={18} />}
        active={!value}
        onClick={() => onPick(null)}
      >
        Unassigned
      </MenuItem>
      {groupMembers.map((m) => (
        <MenuItem
          key={m.user_id}
          icon={<AvatarBubble userId={m.user_id} profiles={memberProfiles} size={18} />}
          active={value === m.user_id}
          onClick={() => onPick(m.user_id)}
        >
          {memberLabel(m.user_id, memberProfiles)}
        </MenuItem>
      ))}
    </>
  );
}

export function RepeatMenuPanel({
  value,
  onPick,
}: {
  value: number | null;
  onPick: (days: number | null) => void;
}) {
  return (
    <>
      <MenuLabel>Repeat</MenuLabel>
      {RECURRENCE_OPTIONS.map((opt) => (
        <MenuItem
          key={opt.label}
          icon={<Repeat className="h-3.5 w-3.5" />}
          active={(value ?? null) === opt.days}
          onClick={() => onPick(opt.days)}
        >
          {opt.label}
        </MenuItem>
      ))}
    </>
  );
}

export function PriorityMenuPanel({
  value,
  onPick,
}: {
  value: Priority;
  onPick: (priority: Priority) => void;
}) {
  const options: { value: Priority; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ];
  return (
    <>
      <MenuLabel>Priority</MenuLabel>
      {options.map((opt) => (
        <MenuItem
          key={opt.value}
          icon={<span className={cn('h-2.5 w-2.5 rounded-full', PRIORITY_DOT[opt.value])} />}
          active={value === opt.value}
          onClick={() => onPick(opt.value)}
        >
          {opt.label}
        </MenuItem>
      ))}
    </>
  );
}
