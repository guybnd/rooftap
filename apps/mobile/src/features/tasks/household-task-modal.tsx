// The to-do sheet on the phone, on the shared ItemSheet (Hearth §7): adding
// opens the quick line (title, Due and Who chips on the keyboard, More for
// the rest); editing opens the list and saves as it closes. Web twin:
// apps/web/src/app/tasks/household-task-modal.tsx. The Repeat field
// (./repeat-field) keeps its Google Calendar style rules.
import * as React from 'react';
import { TextInput } from 'react-native';
import { StickyNote, CalendarDays, Clock, Flag, Repeat } from 'lucide-react-native';
import {
  Avatar,
  AvatarStack,
  DueEditor,
  ItemSheet,
  memberLabel,
  AnyoneFace,
  PeoplePicker,
  PropertyGroup,
  PropertyIcon,
  PropertyRow,
  PropertyRows,
  SegmentedControl,
  TimeEditor,
  useClosePropertyRow,
  type ItemSheetQuickField,
  type PersonOption,
} from '@homeup/ui';
import {
  assigneePatch,
  assigneesOf,
  dueValueLabel,
  peopleLabel,
  toggleAssignee,
  itemSheetDrafts,
  itemTitleError,
  matchTitleWords,
  stripTitleWords,
  personFirstName,
  repeatFollowDue,
  repeatSaveFields,
  repeatValueLabel,
  taskRepeatFields,
  timeValueLabel,
  todayISO,
  useModules,
  type GroupMember,
  type HouseholdTask,
  type TaskRepeatFields,
  type TitleMatch,
} from '@homeup/core';
import { RepeatField } from './repeat-field';
import { randomUUID } from '@/lib/uuid';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet's band wears the section's identity tile.
const HOUSEHOLD_SECTION = { id: 'household', Icon: sectionIconFor('household') };
const DRAFT_KEY = 'household-task';

type Priority = 'low' | 'medium' | 'high';
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

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
  /** Who it is for, first picked first; [] = anyone. */
  assignees: string[];
  repeat: TaskRepeatFields;
  notes: string;
}

interface HouseholdTaskModalProps {
  open: boolean;
  task?: HouseholdTask;
  groupId: string;
  currentUserId: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  /** HOUP-87: pre-fill a new task's due date/time from a calendar slot long-press. Ignored when `task` is set (editing). */
  initialDueDate?: string;
  initialDueTime?: string;
  /** HOUP-147: pre-fill a new task's title (global search "Add as…"). Ignored when `task` is set (editing). */
  defaultTitle?: string;
  onClose: () => void;
  onSave: (task: HouseholdTask) => void;
  onDelete?: (taskId: string) => void;
}

export function HouseholdTaskModal({
  open,
  task,
  groupId,
  currentUserId,
  groupMembers,
  memberProfiles,
  initialDueDate,
  initialDueTime,
  defaultTitle,
  onClose,
  onSave,
  onDelete,
}: HouseholdTaskModalProps) {
  const modules = useModules();
  const rules = modules.server('tasks.repeat-rules');
  // Several people needs the assignees list; an older server keeps one.
  const assigneeList = modules.server('household.assignees');
  const nextPeople = (ids: string[], id: string) =>
    !id ? [] : assigneeList ? toggleAssignee(ids, id) : ids[0] === id ? ids : [id];
  const addPerson = (ids: string[], id: string) => (ids.includes(id) ? ids : assigneeList ? [...ids, id] : [id]);
  const today = todayISO();

  // The caller remounts this component on `task?.id ?? 'new'`, so the
  // initializer alone seeds the form. A blank add picks up a kept draft.
  const [form, setForm] = React.useState<Draft>(() => {
    if (task) {
      return {
        title: task.title,
        dueDate: task.due_date ?? '',
        dueTime: task.due_time?.slice(0, 5) ?? '',
        priority: (task.priority ?? 'medium') as Priority,
        // An edited task that is Unassigned stays Unassigned.
        assignees: assigneesOf(task),
        repeat: taskRepeatFields(task),
        notes: task.notes ?? '',
      };
    }
    const prefilled = defaultTitle != null || initialDueDate != null || initialDueTime != null;
    const kept = prefilled ? undefined : itemSheetDrafts.get<Draft>(DRAFT_KEY);
    return (
      kept ?? {
        title: defaultTitle ?? '',
        // A new to-do starts due today, for whoever opened it.
        dueDate: initialDueDate || today,
        dueTime: initialDueTime ?? '',
        priority: 'medium',
        assignees: currentUserId ? [currentUserId] : [],
        repeat: { recurrence_days: null },
        notes: '',
      }
    );
  });
  const initial = React.useRef(form);
  const [attempted, setAttempted] = React.useState(false);
  const [nudge, setNudge] = React.useState(0);

  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));

  // Title words (Hearth §13.14): a date, time or "@sam" in the title sets
  // Due, Time or Who while it stays in the title, lit, and Add takes it out.
  // Picking that field by hand turns the word back into plain text.
  const [ignored, setIgnored] = React.useState<string[]>([]);
  const wordPeople = React.useMemo(
    () => groupMembers.map((m) => ({ id: m.user_id, name: personFirstName(memberLabel(m.user_id, memberProfiles)) })),
    [groupMembers, memberProfiles]
  );
  const words =
    form.title !== initial.current.title ? matchTitleWords(form.title, { today, people: wordPeople, ignore: ignored }) : [];
  const withWords = (f: Draft): Draft => {
    let next: Draft = words.length ? { ...f, title: stripTitleWords(f.title, words) } : f;
    for (const w of words) {
      if (w.kind === 'due') {
        next = { ...next, dueDate: w.value, repeat: repeatFollowDue(next.repeat, next.dueDate || null, w.value, today, rules) };
      } else if (w.kind === 'time') next = { ...next, dueTime: w.value, dueDate: next.dueDate || today };
      else next = { ...next, assignees: addPerson(next.assignees, w.value) };
    }
    return next;
  };
  // What the rows and chips show: the form with the title's words applied.
  const view = withWords(form);
  const lit = (kind: TitleMatch['kind']) => words.some((w) => w.kind === kind);
  const keepAsText = (kind: TitleMatch['kind']) => {
    const raws = words.filter((w) => w.kind === kind).map((w) => w.raw.toLowerCase());
    if (raws.length) setIgnored((i) => [...i, ...raws]);
  };
  const pickTime = (dueTime: string) => {
    keepAsText('time');
    setForm((f) => ({ ...f, dueTime, dueDate: view.dueDate }));
  };
  const pickWho = (id: string) => {
    keepAsText('who');
    setForm((f) => ({ ...f, assignees: nextPeople(view.assignees, id) }));
  };
  // A repeat picked while a date word is lit keeps that date.
  const pickRepeat = (repeat: TaskRepeatFields) => setForm((f) => ({ ...f, repeat, dueDate: view.dueDate }));

  // Moving the date keeps a picked repeat on the same pattern ("Weekly on
  // Sunday" becomes "Weekly on Monday"); a custom rule stays as it is.
  // Clearing the date clears the time too.
  const setDue = (next: string) => {
    keepAsText('due');
    setForm((f) => ({
      ...f,
      dueDate: next,
      dueTime: next ? view.dueTime : '',
      repeat: repeatFollowDue(view.repeat, view.dueDate || null, next || null, today, rules),
    }));
  };

  const build = (f: Draft): HouseholdTask => {
    // A repeating task with no date starts on its rule's first day.
    const { due_date, ...repeatFields } = repeatSaveFields(f.repeat, f.dueDate || null, today);
    const due_time = due_date ? f.dueTime || null : null;
    const fields = {
      title: f.title.trim(),
      due_date,
      due_time,
      priority: f.priority,
      ...assigneePatch(f.assignees, assigneeList),
      ...repeatFields,
      notes: f.notes.trim() || null,
    };
    if (task) {
      // Detach from the moving template when the date changed by hand.
      const detach = !!task.template_key && task.offset_days != null && due_date !== task.due_date;
      return { ...task, ...fields, ...(detach ? { template_key: null, offset_days: null } : {}) };
    }
    return {
      id: randomUUID(),
      group_id: groupId,
      ...fields,
      offset_days: null,
      done: false,
      completed_at: null,
      private: false,
      template_key: null,
      sort_order: 0,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    };
  };

  const submit = () => {
    // The title's words leave it as it saves.
    const final = view;
    if (task) {
      // Editing saves as it closes. An emptied title keeps the old one.
      const f = final.title.trim() ? final : { ...final, title: task.title };
      if (JSON.stringify(f) === JSON.stringify(initial.current)) onClose();
      else onSave(build(f));
      return;
    }
    if (!final.title.trim()) {
      setAttempted(true);
      setNudge((n) => n + 1);
      return;
    }
    itemSheetDrafts.clear(DRAFT_KEY);
    onSave(build(final));
  };

  const closeAdd = () => {
    // Typing is never lost to a stray swipe: the draft waits for the next add.
    const touched = JSON.stringify(form) !== JSON.stringify(initial.current);
    if (form.title.trim() && touched) itemSheetDrafts.set(DRAFT_KEY, form);
    else if (!form.title.trim()) itemSheetDrafts.clear(DRAFT_KEY);
    onClose();
  };

  const people = React.useMemo<PersonOption[]>(
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
  const whoLabel = peopleLabel(
    view.assignees.map((id) => personFirstName(memberLabel(id, memberProfiles))),
    'Anyone'
  );
  const whoFace = (size: number) =>
    view.assignees.length > 0 ? <AvatarStack ids={view.assignees} profiles={memberProfiles} size={size} max={2} /> : <AnyoneFace size={size} />;

  const quickFields: ItemSheetQuickField[] = [
    {
      id: 'due',
      label: dueValueLabel(view.dueDate, today),
      icon: <CalendarDays size={14} className="text-muted-foreground" />,
      set: !!view.dueDate,
      lit: lit('due') || lit('time'),
      trayLabel: 'Due',
      editor: <DueEditor value={view.dueDate} onChange={setDue} />,
    },
    {
      id: 'who',
      label: whoLabel,
      icon: whoFace(18),
      set: view.assignees.length > 0,
      lit: lit('who'),
      trayLabel: 'Who',
      editor: <WhoEditor people={people} selected={view.assignees} many={assigneeList} onChange={pickWho} />,
    },
  ];

  const firstNoteLine = form.notes.trim().split('\n')[0];

  return (
    <ItemSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeAdd();
      }}
      mode={task ? 'edit' : 'add'}
      section={HOUSEHOLD_SECTION}
      heading={task ? 'To-do' : 'New to-do'}
      caption="Household"
      title={form.title}
      onTitleChange={(title) => set({ title })}
      titleMarks={words}
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
          <PropertyRow id="due" leading={<PropertyIcon Icon={CalendarDays} />} label="Due" value={dueValueLabel(view.dueDate, today)} valueSet={!!view.dueDate}>
            <DueEditor value={view.dueDate} onChange={setDue} />
          </PropertyRow>
          {!!view.dueDate && (
            <PropertyRow id="time" leading={<PropertyIcon Icon={Clock} />} label="Time" value={timeValueLabel(view.dueTime)} valueSet={!!view.dueTime}>
              <TimeEditor value={view.dueTime} onChange={(dueTime) => pickTime(dueTime)} />
            </PropertyRow>
          )}
          <PropertyRow id="who" leading={whoFace(28)} label="Who" value={whoLabel} valueSet={view.assignees.length > 0}>
            <WhoEditor people={people} selected={view.assignees} many={assigneeList} onChange={pickWho} />
          </PropertyRow>
          <PropertyRow
            id="repeat"
            leading={<PropertyIcon Icon={Repeat} />}
            label="Repeat"
            value={repeatValueLabel(view.repeat)}
            valueSet={!!view.repeat.recurrence_days}
          >
            <RepeatField inline value={view.repeat} dueDate={view.dueDate || null} rules={rules} onChange={pickRepeat} />
          </PropertyRow>
          <PropertyRow
            id="priority"
            leading={<PropertyIcon Icon={Flag} />}
            label="Priority"
            control={
              <SegmentedControl options={PRIORITY_OPTIONS} value={form.priority} onChange={(priority) => set({ priority })} size="sm" accessibilityLabel="Priority" />
            }
          />
          <PropertyRow id="notes" leading={<PropertyIcon Icon={StickyNote} />} label="Notes" value={firstNoteLine || 'None'} valueSet={!!firstNoteLine}>
            <TextInput
              value={form.notes}
              onChangeText={(notes) => set({ notes })}
              placeholder="Anything to remember"
              multiline
              autoFocus
              textAlignVertical="top"
              className="min-h-20 rounded-xl bg-card px-3 py-2 text-body text-foreground placeholder:text-muted-foreground"
            />
          </PropertyRow>
        </PropertyGroup>
      </PropertyRows>
    </ItemSheet>
  );
}

/**
 * Who: faces to tap. Each face adds or takes off a person and the row stays
 * open; Anyone clears and closes. On an older server one pick is final.
 */
function WhoEditor({
  people,
  selected,
  many,
  onChange,
}: {
  people: PersonOption[];
  selected: string[];
  many: boolean;
  onChange: (id: string) => void;
}) {
  const close = useClosePropertyRow();
  return (
    <PeoplePicker
      people={people}
      selected={selected}
      onChange={(id) => {
        onChange(id);
        if (!many || !id) close();
      }}
    />
  );
}


