// HOUP-120: native add/edit sheet for a household task, brought to parity
// with apps/web/src/app/tasks/household-task-modal.tsx — refactored onto
// `ItemFormSheet` (gets the live preview header + a consistent
// delete/cancel/save footer for free instead of a hand-rolled one), the
// Repeat field (./repeat-field: Google Calendar style rules), assignee reassignment via the new
// `AssigneePicker` (needs `groupMembers`/`memberProfiles`, both now exposed
// by `useDataCache()`), and a destructive-confirm on Delete (Hearth M4:
// "center dialogs only for destructive confirms" — `dialog.alert` is this
// codebase's established native confirm surface, see
// apps/mobile/src/app/(tabs)/documents/index.tsx's delete flow).
import * as React from 'react';
import { View } from 'react-native';
import {
  Text,
  AssigneePicker,
  Button,
  DateScrollField,
  FieldRow,
  Input,
  ItemFormSheet,
  SegmentedControl,
  TimeScrollField,
} from '@homeup/ui';
import {
  addDaysISO,
  dueDayLabel,
  repeatFollowDue,
  repeatSaveFields,
  taskRepeatFields,
  todayISO,
  useModules,
  type GroupMember,
  type HouseholdTask,
  type TaskRepeatFields,
} from '@homeup/core';
import { RepeatField } from './repeat-field';
import { randomUUID } from '@/lib/uuid';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const HOUSEHOLD_SECTION = { id: 'household', Icon: sectionIconFor('household') };

type Priority = 'low' | 'medium' | 'high';
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];
const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Med', high: 'High' };

// Live preview of the priority in the sheet header: a tinted word like the
// row's meta, never a filled pill (Hearth §6). Mirrors web.
const PRIORITY_WORD: Record<Priority, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
};

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
  // The caller remounts this component on `task?.id ?? 'new'` (mirrors
  // apps/mobile/src/app/costs/cost-modal.tsx), so these initializers alone
  // are enough to re-seed the form — no resync effect needed.
  const [title, setTitle] = React.useState(task?.title ?? defaultTitle ?? '');
  // A new to-do starts due today (matches the web modal); Clear still leaves
  // it undated. An edited task keeps its saved date, including none.
  const [dueDate, setDueDate] = React.useState(task ? task.due_date ?? '' : initialDueDate || todayISO());
  const [dueTime, setDueTime] = React.useState(task?.due_time?.slice(0, 5) ?? initialDueTime ?? '');
  const [priority, setPriority] = React.useState<Priority>((task?.priority ?? 'medium') as Priority);
  // Only default to self when creating — an edited task that's explicitly
  // Unassigned (assigned_to === null) must stay Unassigned (mirrors the web
  // modal's `isNew` gate at apps/web/src/app/tasks/household-task-modal.tsx:82).
  const [assignedTo, setAssignedTo] = React.useState<string | null>(
    task?.assigned_to ?? (task ? null : currentUserId ?? null)
  );
  // FLUX-182/HOUP-189: "Does not repeat" unless the task already repeats.
  // repeat_rule rides along only when the row has it, so an older server never sees it.
  const rules = useModules().server('tasks.repeat-rules');
  const [repeat, setRepeat] = React.useState<TaskRepeatFields>(() =>
    task ? taskRepeatFields(task) : { recurrence_days: null }
  );
  // Moving the date keeps a picked repeat on the same pattern ("Weekly on
  // Sunday" becomes "Weekly on Monday"); a custom rule stays as it is.
  const changeDue = (next: string) => {
    setRepeat((r) => repeatFollowDue(r, dueDate || null, next || null, todayISO(), rules));
    setDueDate(next);
  };
  const [notes, setNotes] = React.useState(task?.notes ?? '');

  const canSave = title.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    // A repeating task with no date starts on its rule's first day.
    const { due_date: finalDueDate, ...repeatFields } = repeatSaveFields(repeat, dueDate || null, todayISO());
    const finalDueTime = finalDueDate ? dueTime || null : null;
    // Detach from the moving template when the date changed by hand — it's
    // now the user's own date (mirrors the web modal's same rule).
    const detach = !!task?.template_key && task.offset_days != null && finalDueDate !== task.due_date;

    if (task) {
      onSave({
        ...task,
        title: title.trim(),
        due_date: finalDueDate,
        due_time: finalDueTime,
        priority,
        assigned_to: assignedTo,
        ...repeatFields,
        notes: notes.trim() || null,
        ...(detach ? { template_key: null, offset_days: null } : {}),
      });
    } else {
      onSave({
        id: randomUUID(),
        group_id: groupId,
        title: title.trim(),
        due_date: finalDueDate,
        due_time: finalDueTime,
        offset_days: null,
        ...repeatFields,
        done: false,
        completed_at: null,
        assigned_to: assignedTo,
        private: false,
        template_key: null,
        notes: notes.trim() || null,
        sort_order: 0,
        priority,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }
  };

  const requestDelete = () => {
    if (!task || !onDelete) return;
    onDelete(task.id);
    onClose();
  };

  return (
    <ItemFormSheet
      section={HOUSEHOLD_SECTION}
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={task ? 'Edit task' : 'Add to-do'}
      previewContent={
        <>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
            {title.trim() || (task ? 'Edit task' : 'Add to-do')}
          </Text>
          {!!dueDate && <Text className="shrink-0 text-xs text-muted-foreground">{dueDayLabel(dueDate)}</Text>}
          <Text className={`shrink-0 text-xs font-medium ${PRIORITY_WORD[priority]}`}>{PRIORITY_LABEL[priority]}</Text>
        </>
      }
      onSubmit={save}
      canSubmit={canSave}
      onDelete={task && onDelete ? requestDelete : undefined}
      deleteConfirmTitle={task ? `Delete "${task.title}"?` : undefined}
      deleteConfirmMessage="This removes it from the list."
    >
      <FieldRow label="Task">
        <Input value={title} onChangeText={setTitle} placeholder="e.g., Change electricity over" autoFocus />
      </FieldRow>

      <FieldRow
        label="Due date"
        action={
          !!dueDate && (
            <Button variant="ghost" size="xs" onPress={() => { changeDue(''); setDueTime(''); }}>
              Clear
            </Button>
          )
        }
      >
        <View className="gap-1.5">
          <View className="flex-row flex-wrap gap-1.5">
            {[
              { label: 'Today', value: todayISO() },
              { label: 'Tomorrow', value: addDaysISO(todayISO(), 1) },
              { label: 'Next week', value: addDaysISO(todayISO(), 7) },
            ].map((chip) => (
              <Button
                key={chip.label}
                variant={dueDate === chip.value ? 'default' : 'outline'}
                size="xs"
                onPress={() => changeDue(chip.value)}
              >
                {chip.label}
              </Button>
            ))}
          </View>
          <View className="rounded-lg border border-border bg-muted/30 py-2">
            <DateScrollField value={dueDate} onChange={changeDue} />
          </View>
        </View>
      </FieldRow>

      {!!dueDate && (
        <FieldRow
          label="Time"
          action={
            !!dueTime && (
              <Button variant="ghost" size="xs" onPress={() => setDueTime('')}>
                Clear time
              </Button>
            )
          }
        >
          {dueTime ? (
            <View className="rounded-lg border border-border bg-muted/30 py-2">
              <TimeScrollField value={dueTime} onChange={setDueTime} />
            </View>
          ) : (
            <Button variant="outline" onPress={() => setDueTime('09:00')}>
              + Add a time
            </Button>
          )}
        </FieldRow>
      )}

      <FieldRow label="Assignee">
        <AssigneePicker
          value={assignedTo}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          currentUserId={currentUserId}
          onChange={(userId) => setAssignedTo(userId || null)}
          showLabel
        />
      </FieldRow>

      <FieldRow label="Priority">
        <SegmentedControl options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} />
      </FieldRow>

      <FieldRow label="Repeat">
        <RepeatField value={repeat} dueDate={dueDate || null} rules={rules} onChange={setRepeat} />
      </FieldRow>

      <FieldRow label="Notes">
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional details..."
          multiline
          numberOfLines={3}
          className="h-20 py-2"
          textAlignVertical="top"
        />
      </FieldRow>
    </ItemFormSheet>
  );
}
