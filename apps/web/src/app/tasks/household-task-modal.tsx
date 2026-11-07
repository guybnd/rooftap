'use client';

// The to-do sheet on web, on the shared ItemSheet (Hearth §7): adding opens
// the quick line (title, Due and Who chips, More for the rest); editing opens
// the list and saves as it closes. Phone twin:
// apps/mobile/src/features/tasks/household-task-modal.tsx.
//
// FLUX-150: the sheet never calls Supabase. It builds the task and calls
// onSave/onDelete; the parent routes writes through the Legend store.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock, Flag, Repeat, StickyNote, UserRound } from 'lucide-react';
import {
  dueValueLabel,
  itemSheetDrafts,
  itemTitleError,
  personFirstName,
  repeatFollowDue,
  repeatSaveFields,
  repeatValueLabel,
  timeValueLabel,
  todayISO,
  useModules,
  type HouseholdTask,
  type TaskRepeatFields,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { memberLabel } from '../setup/member-label';
import { Avatar } from '../setup/assignee-picker';
import {
  DueEditor,
  ItemSheet,
  PeoplePicker,
  PropertyGroup,
  PropertyIcon,
  PropertyRow,
  PropertyRows,
  TimeEditor,
  useClosePropertyRow,
  type ItemSheetQuickField,
  type PersonOption,
} from '@/components/ui/item-sheet';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { RepeatField } from './repeat-field';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet's band wears the section's identity tile.
const HOUSEHOLD_SECTION = { id: 'household', Icon: sectionIconFor('household') };
const DRAFT_KEY = 'household-task';

type Priority = 'low' | 'medium' | 'high';
const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'High' },
];

interface Draft {
  title: string;
  dueDate: string;
  dueTime: string;
  priority: Priority;
  assignedTo: string;
  repeat: TaskRepeatFields;
  notes: string;
}

interface HouseholdTaskModalProps {
  isOpen: boolean;
  task?: HouseholdTask;
  groupId: string;
  /** Pre-fill the title for new tasks (ignored when `task` is provided). */
  defaultTitle?: string;
  /** Pre-fill the due date for new tasks, YYYY-MM-DD (ignored when `task` is provided). */
  defaultDueDate?: string;
  /** Pre-fill the due time for new tasks, HH:MM wall-clock (ignored when `task` is provided). */
  defaultDueTime?: string;
  onClose: () => void;
  onSave: (task: HouseholdTask) => void;
  onDelete?: (taskId: string) => void;
}

export function HouseholdTaskModal({ isOpen, task, groupId, defaultTitle, defaultDueDate, defaultDueTime, onClose, onSave, onDelete }: HouseholdTaskModalProps) {
  const { groupMembers, memberProfiles, currentUserId } = useDataCache();
  const rules = useModules().server('tasks.repeat-rules');
  const today = todayISO();

  const buildInitialForm = useCallback((): Draft => {
    if (task) {
      return {
        title: task.title,
        dueDate: task.due_date ?? '',
        // Postgres `time` returns HH:MM:SS; the form keeps HH:MM. '' = all-day.
        dueTime: task.due_time ? task.due_time.slice(0, 5) : '',
        priority: (task.priority ?? 'medium') as Priority,
        assignedTo: task.assigned_to ?? '',
        // repeat_rule rides along only when the task has one, so an older server never sees it.
        repeat: {
          recurrence_days: task.recurrence_days ?? null,
          ...(task.repeat_rule !== undefined ? { repeat_rule: task.repeat_rule } : {}),
        } as TaskRepeatFields,
        notes: task.notes ?? '',
      };
    }
    const prefilled = defaultTitle != null || defaultDueDate != null || defaultDueTime != null;
    const kept = prefilled ? undefined : itemSheetDrafts.get<Draft>(DRAFT_KEY);
    return (
      kept ?? {
        title: defaultTitle ?? '',
        // New tasks default to today, for whoever opened the sheet (FLUX-142).
        dueDate: defaultDueDate || todayISO(),
        dueTime: defaultDueTime ?? '',
        priority: 'medium',
        assignedTo: currentUserId ?? '',
        repeat: { recurrence_days: null },
        notes: '',
      }
    );
  }, [task, defaultTitle, defaultDueDate, defaultDueTime, currentUserId]);

  const [form, setForm] = useState<Draft>(buildInitialForm);
  const initial = useRef(form);
  const [attempted, setAttempted] = useState(false);
  const [nudge, setNudge] = useState(0);

  // FLUX-186: the instance is reused across opens, so re-seed on every
  // closed-to-open change.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const next = buildInitialForm();
      setForm(next);
      initial.current = next;
      setAttempted(false);
    }
    wasOpen.current = isOpen;
  }, [isOpen, buildInitialForm]);

  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));
  // Moving the date keeps a picked repeat on the same pattern; clearing it clears the time.
  const setDue = (next: string) =>
    setForm((f) => ({
      ...f,
      dueDate: next,
      dueTime: next ? f.dueTime : '',
      repeat: repeatFollowDue(f.repeat, f.dueDate || null, next || null, todayISO(), rules),
    }));

  const build = (f: Draft): HouseholdTask => {
    // A repeating task with no date starts on its rule's first day.
    const { due_date, ...repeat } = repeatSaveFields(f.repeat, f.dueDate || null, todayISO());
    const fields = {
      title: f.title.trim(),
      due_date,
      due_time: due_date ? f.dueTime || null : null,
      ...repeat,
      assigned_to: f.assignedTo || null,
      priority: f.priority,
      notes: f.notes.trim() || null,
    };
    if (task?.id) {
      // Detach from the moving template when the date changed by hand (FLUX-142).
      const detach = task.template_key != null && task.offset_days != null && due_date !== task.due_date;
      return { ...task, ...fields, ...(detach ? { template_key: null, offset_days: null } : {}) };
    }
    // A stable id lets the parent pin it at once; null timestamps signal INSERT (gotcha 5).
    return {
      id: crypto.randomUUID(),
      group_id: groupId,
      ...fields,
      done: false,
      completed_at: null,
      private: false,
      template_key: null,
      offset_days: null,
      sort_order: 0,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    };
  };

  const submit = () => {
    if (task) {
      // Editing saves as it closes. An emptied title keeps the old one.
      const f = form.title.trim() ? form : { ...form, title: task.title };
      if (JSON.stringify(f) !== JSON.stringify(initial.current)) onSave(build(f));
      onClose();
      return;
    }
    if (!form.title.trim()) {
      setAttempted(true);
      setNudge((n) => n + 1);
      return;
    }
    itemSheetDrafts.clear(DRAFT_KEY);
    onSave(build(form));
    onClose();
  };

  const closeAdd = () => {
    // Typing is never lost to a stray Esc or swipe: the draft waits for the next add.
    if (form.title.trim() && JSON.stringify(form) !== JSON.stringify(initial.current)) itemSheetDrafts.set(DRAFT_KEY, form);
    else if (!form.title.trim()) itemSheetDrafts.clear(DRAFT_KEY);
    onClose();
  };

  const people = useMemo<PersonOption[]>(
    () => [
      { id: '', name: 'Anyone', face: <AnyoneFace /> },
      ...groupMembers.map((m) => ({
        id: m.user_id,
        name: personFirstName(memberLabel(m.user_id, memberProfiles)),
        face: <Avatar userId={m.user_id} profiles={memberProfiles} size={34} />,
      })),
    ],
    [groupMembers, memberProfiles]
  );
  const whoLabel = form.assignedTo ? personFirstName(memberLabel(form.assignedTo, memberProfiles)) : 'Anyone';
  const whoFace = (size: number) =>
    form.assignedTo ? <Avatar userId={form.assignedTo} profiles={memberProfiles} size={size} /> : <AnyoneFace size={size} />;
  const whoEditor = <WhoEditor people={people} value={form.assignedTo} onChange={(assignedTo) => set({ assignedTo })} />;

  const quickFields: ItemSheetQuickField[] = [
    {
      id: 'due',
      label: dueValueLabel(form.dueDate, today),
      icon: <CalendarDays className="size-3.5 text-muted-foreground" />,
      set: !!form.dueDate,
      trayLabel: 'Due',
      editor: <DueEditor value={form.dueDate} onChange={setDue} />,
    },
    { id: 'who', label: whoLabel, icon: whoFace(18), set: !!form.assignedTo, trayLabel: 'Who', editor: whoEditor },
  ];

  const firstNoteLine = form.notes.trim().split('\n')[0];

  return (
    <ItemSheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) closeAdd();
      }}
      mode={task ? 'edit' : 'add'}
      section={HOUSEHOLD_SECTION}
      heading={task ? 'To-do' : 'New to-do'}
      caption="Household"
      title={form.title}
      onTitleChange={(title) => set({ title })}
      titlePlaceholder="What needs doing?"
      titleError={itemTitleError(form.title, attempted)}
      nudge={nudge}
      quickFields={quickFields}
      onSubmit={submit}
      submitLabel="Add to-do"
      onDelete={task && onDelete ? () => { onDelete(task.id); onClose(); } : undefined}
      deleteLabel="Delete to-do"
      deleteConfirmTitle={task ? `Delete "${task.title}"?` : undefined}
      deleteConfirmMessage="This removes it from the list."
    >
      <PropertyRows>
        <PropertyGroup>
          <PropertyRow id="due" leading={<PropertyIcon Icon={CalendarDays} />} label="Due" value={dueValueLabel(form.dueDate, today)} valueSet={!!form.dueDate}>
            <DueEditor value={form.dueDate} onChange={setDue} />
          </PropertyRow>
          {form.dueDate && (
            <PropertyRow id="time" leading={<PropertyIcon Icon={Clock} />} label="Time" value={timeValueLabel(form.dueTime)} valueSet={!!form.dueTime}>
              <TimeEditor value={form.dueTime} onChange={(dueTime) => set({ dueTime })} />
            </PropertyRow>
          )}
          <PropertyRow id="who" leading={whoFace(28)} label="Who" value={whoLabel} valueSet={!!form.assignedTo}>
            {whoEditor}
          </PropertyRow>
          <PropertyRow id="repeat" leading={<PropertyIcon Icon={Repeat} />} label="Repeat" value={repeatValueLabel(form.repeat)} valueSet={!!form.repeat.recurrence_days}>
            <RepeatField inline value={form.repeat} dueDate={form.dueDate || null} rules={rules} onChange={(repeat) => set({ repeat })} />
          </PropertyRow>
          <PropertyRow
            id="priority"
            leading={<PropertyIcon Icon={Flag} />}
            label="Priority"
            control={<SegmentedControl options={PRIORITY_OPTIONS} value={form.priority} onChange={(priority) => set({ priority })} size="sm" ariaLabel="Priority" />}
          />
          <PropertyRow id="notes" leading={<PropertyIcon Icon={StickyNote} />} label="Notes" value={firstNoteLine || 'None'} valueSet={!!firstNoteLine}>
            <textarea
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Anything to remember"
              aria-label="Notes"
              rows={3}
              autoFocus
              className="field-sizing-content min-h-20 w-full resize-none rounded-xl bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </PropertyRow>
        </PropertyGroup>
      </PropertyRows>
    </ItemSheet>
  );
}

/** Who: faces to tap. A pick is final, so the row (or tray) closes. */
function WhoEditor({ people, value, onChange }: { people: PersonOption[]; value: string; onChange: (id: string) => void }) {
  const close = useClosePropertyRow();
  return (
    <PeoplePicker
      people={people}
      value={value}
      onChange={(id) => {
        onChange(id);
        close();
      }}
    />
  );
}

function AnyoneFace({ size = 34 }: { size?: number }) {
  return (
    <span className="grid place-items-center rounded-full bg-muted text-muted-foreground" style={{ width: size, height: size }}>
      <UserRound style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

