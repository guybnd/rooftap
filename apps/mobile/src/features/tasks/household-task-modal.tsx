// The to-do sheet on the phone, on the shared ItemSheet (Hearth §7): adding
// opens the quick line (title, Due and Who chips on the keyboard, More for
// the rest); editing opens the list and saves as it closes. Web twin:
// apps/web/src/app/tasks/household-task-modal.tsx. The Repeat field
// (./repeat-field) keeps its Google Calendar style rules.
import * as React from 'react';
import { TextInput, View } from 'react-native';
import { StickyNote, CalendarDays, Clock, Flag, Repeat, UserRound } from 'lucide-react-native';
import {
  Avatar,
  DueEditor,
  ItemSheet,
  memberLabel,
  PeoplePicker,
  PropertyGroup,
  PropertyIcon,
  PropertyRow,
  PropertyRows,
  SegmentedControl,
  TimeEditor,
  useClosePropertyRow,
  type ItemSheetQuickField,
  type ItemSheetTitleMatch,
  type PersonOption,
} from '@homeup/ui';
import {
  dueValueLabel,
  itemSheetDrafts,
  itemTitleError,
  matchTitleWords,
  personFirstName,
  repeatFollowDue,
  repeatSaveFields,
  repeatValueLabel,
  taskRepeatFields,
  timeValueLabel,
  titleMatchLabel,
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
  assignedTo: string | null;
  repeat: TaskRepeatFields;
  notes: string;
}

/** Words the title gave a field, and what that field held before. */
interface TakenWords {
  match: TitleMatch;
  before: Partial<Draft>;
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
  const rules = useModules().server('tasks.repeat-rules');
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
        assignedTo: task.assigned_to ?? null,
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
        assignedTo: currentUserId ?? null,
        repeat: { recurrence_days: null },
        notes: '',
      }
    );
  });
  const initial = React.useRef(form);
  const [attempted, setAttempted] = React.useState(false);
  const [nudge, setNudge] = React.useState(0);

  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));

  // Title words: "tomorrow", "friday", "5pm" or "@sam" in the title set Due,
  // Time or Who, leave the title, and show as a chip that puts them back.
  const [taken, setTaken] = React.useState<TakenWords[]>([]);
  const [ignored, setIgnored] = React.useState<string[]>([]);
  const wordPeople = React.useMemo(
    () => groupMembers.map((m) => ({ id: m.user_id, name: personFirstName(memberLabel(m.user_id, memberProfiles)) })),
    [groupMembers, memberProfiles]
  );
  const takeWords = (f: Draft, raw: string, final: boolean): { next: Draft; found: TakenWords[] } => {
    const { title, matches } = matchTitleWords(raw, { today, people: wordPeople, final, ignore: ignored });
    let next: Draft = { ...f, title };
    const found: TakenWords[] = [];
    for (const match of matches) {
      if (match.kind === 'due') {
        found.push({ match, before: { dueDate: next.dueDate, repeat: next.repeat } });
        next = { ...next, dueDate: match.value, repeat: repeatFollowDue(next.repeat, next.dueDate || null, match.value, today, rules) };
      } else if (match.kind === 'time') {
        found.push({ match, before: { dueTime: next.dueTime, dueDate: next.dueDate } });
        next = { ...next, dueTime: match.value, dueDate: next.dueDate || today };
      } else {
        found.push({ match, before: { assignedTo: next.assignedTo } });
        next = { ...next, assignedTo: match.value };
      }
    }
    return { next, found };
  };
  const onTitleChange = (raw: string) => {
    const { next, found } = takeWords(form, raw, false);
    setForm(next);
    if (found.length) setTaken((t) => [...t.filter((x) => !found.some((n) => n.match.kind === x.match.kind)), ...found]);
  };
  const putWordsBack = (raw: string) => {
    const back = taken.filter((t) => t.match.raw === raw);
    setForm((f) => {
      let next = { ...f, title: `${f.title.trimEnd()} ${raw}`.trimStart() };
      for (const t of back) next = { ...next, ...t.before };
      return next;
    });
    setIgnored((i) => [...i, raw.toLowerCase()]);
    setTaken((t) => t.filter((x) => x.match.raw !== raw));
  };
  const titleMatches: ItemSheetTitleMatch[] = taken
    .filter((t, i) => taken.findIndex((x) => x.match.raw === t.match.raw) === i)
    .map((t) => ({
      id: t.match.raw,
      label: taken
        .filter((x) => x.match.raw === t.match.raw)
        .map((x) => titleMatchLabel(x.match, today, wordPeople))
        .join(', '),
      icon:
        t.match.kind === 'who' ? (
          <Avatar userId={t.match.value} profiles={memberProfiles} size={18} />
        ) : t.match.kind === 'time' ? (
          <Clock size={13} className="text-primary" />
        ) : (
          <CalendarDays size={13} className="text-primary" />
        ),
      onPress: () => putWordsBack(t.match.raw),
    }));
  // Words still being typed at the end of a changed title: shown dashed, and
  // a tap (or a space, or saving) sets them.
  const pendingWords =
    form.title !== initial.current.title
      ? matchTitleWords(form.title, { today, people: wordPeople, final: true, ignore: ignored }).matches
      : [];
  if (pendingWords.length) {
    titleMatches.push({
      id: 'pending',
      label: pendingWords.map((m) => titleMatchLabel(m, today, wordPeople)).join(', '),
      icon: pendingWords[0].kind === 'who' ? (
        <Avatar userId={pendingWords[0].value} profiles={memberProfiles} size={18} />
      ) : pendingWords[0].kind === 'time' ? (
        <Clock size={13} className="text-primary" />
      ) : (
        <CalendarDays size={13} className="text-primary" />
      ),
      pending: true,
      onPress: () => {
        const { next, found } = takeWords(form, form.title, true);
        setForm({ ...next, title: next.title ? `${next.title} ` : '' });
        setTaken((t) => [...t.filter((x) => !found.some((n) => n.match.kind === x.match.kind)), ...found]);
      },
    });
  }
  // Moving the date keeps a picked repeat on the same pattern ("Weekly on
  // Sunday" becomes "Weekly on Monday"); a custom rule stays as it is.
  // Clearing the date clears the time too.
  const setDue = (next: string) =>
    setForm((f) => ({
      ...f,
      dueDate: next,
      dueTime: next ? f.dueTime : '',
      repeat: repeatFollowDue(f.repeat, f.dueDate || null, next || null, today, rules),
    }));

  const build = (f: Draft): HouseholdTask => {
    // A repeating task with no date starts on its rule's first day.
    const { due_date, ...repeatFields } = repeatSaveFields(f.repeat, f.dueDate || null, today);
    const due_time = due_date ? f.dueTime || null : null;
    const fields = {
      title: f.title.trim(),
      due_date,
      due_time,
      priority: f.priority,
      assigned_to: f.assignedTo,
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
    // Words still at the end of a changed title count as it saves.
    const final = form.title !== initial.current.title ? takeWords(form, form.title, true).next : form;
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
  const whoLabel = form.assignedTo ? personFirstName(memberLabel(form.assignedTo, memberProfiles)) : 'Anyone';
  const whoFace = (size: number) =>
    form.assignedTo ? <Avatar userId={form.assignedTo} profiles={memberProfiles} size={size} /> : <AnyoneFace size={size} />;

  const quickFields: ItemSheetQuickField[] = [
    {
      id: 'due',
      label: dueValueLabel(form.dueDate, today),
      icon: <CalendarDays size={14} className="text-muted-foreground" />,
      set: !!form.dueDate,
      trayLabel: 'Due',
      editor: <DueEditor value={form.dueDate} onChange={setDue} />,
    },
    {
      id: 'who',
      label: whoLabel,
      icon: whoFace(18),
      set: !!form.assignedTo,
      trayLabel: 'Who',
      editor: <WhoEditor people={people} value={form.assignedTo ?? ''} onChange={(id) => set({ assignedTo: id || null })} />,
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
      onTitleChange={onTitleChange}
      titleMatches={titleMatches}
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
          {!!form.dueDate && (
            <PropertyRow id="time" leading={<PropertyIcon Icon={Clock} />} label="Time" value={timeValueLabel(form.dueTime)} valueSet={!!form.dueTime}>
              <TimeEditor value={form.dueTime} onChange={(dueTime) => set({ dueTime })} />
            </PropertyRow>
          )}
          <PropertyRow id="who" leading={whoFace(28)} label="Who" value={whoLabel} valueSet={!!form.assignedTo}>
            <WhoEditor people={people} value={form.assignedTo ?? ''} onChange={(id) => set({ assignedTo: id || null })} />
          </PropertyRow>
          <PropertyRow
            id="repeat"
            leading={<PropertyIcon Icon={Repeat} />}
            label="Repeat"
            value={repeatValueLabel(form.repeat)}
            valueSet={!!form.repeat.recurrence_days}
          >
            <RepeatField inline value={form.repeat} dueDate={form.dueDate || null} rules={rules} onChange={(repeat) => set({ repeat })} />
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
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-muted">
      <UserRound size={size * 0.5} className="text-muted-foreground" />
    </View>
  );
}

