'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { memberLabel } from '../setup/member-label';
import { todayISO, addDaysISO } from './moving-tasks';
import { DateScrollField } from '@/components/date-scroll-field';
import { TimeScrollField } from '@/components/time-scroll-field';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { PrioritySlider, type Priority } from '@/components/ui/priority-slider';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dueDayLabel, repeatFollowDue, repeatSaveFields, useModules, type HouseholdTask, type TaskRepeatFields } from '@homeup/core';
import { RepeatField } from './repeat-field';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const HOUSEHOLD_SECTION = { id: 'household', Icon: sectionIconFor('household') };

// FLUX-234: live preview of the priority in the drawer header — a tinted
// word like the row's meta, never a filled pill (Hearth §6).
const PRIORITY_WORD: Record<Priority, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
};
const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Med', high: 'High' };

// FLUX-150: modal no longer calls Supabase directly — it builds the task locally
// and calls onSave/onDelete synchronously. The parent page routes writes through
// the Legend store (IndexedDB-queued, offline-safe, auto-retry).

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
  const isNew = !task;
  const rules = useModules().server('tasks.repeat-rules');

  const buildInitialForm = useCallback(() => {
    return {
      title: task?.title || defaultTitle || '',
      // New tasks default to today, assigned to whoever opened the modal (FLUX-142).
      // FLUX-233: a long-pressed calendar slot pre-fills its own date/time instead.
      due_date: task?.due_date ?? (isNew ? defaultDueDate || todayISO() : ''),
      // Wall-clock time, normalised to HH:MM (Postgres `time` returns HH:MM:SS); '' = all-day (FLUX-144).
      due_time: task?.due_time ? task.due_time.slice(0, 5) : isNew ? defaultDueTime || '' : '',
      // FLUX-182: Repeat defaults to "Does not repeat". repeat_rule rides
      // along only when the task has one, so an older server never sees it.
      repeat: {
        recurrence_days: task?.recurrence_days ?? null,
        ...(task?.repeat_rule !== undefined ? { repeat_rule: task.repeat_rule } : {}),
      } as TaskRepeatFields,
      assigned_to: task?.assigned_to ?? (isNew ? currentUserId ?? '' : ''),
      priority: (task?.priority ?? 'medium') as Priority,
      notes: task?.notes || '',
    };
  }, [task, defaultTitle, defaultDueDate, defaultDueTime, isNew, currentUserId]);

  const [formData, setFormData] = useState(buildInitialForm);

  // FLUX-186: instance is reused across opens (stable `key` for blank adds), so
  // re-seed the form on every closed→open transition — otherwise adding a second
  // task pre-fills the one you just added.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setFormData(buildInitialForm());
    wasOpen.current = isOpen;
  }, [isOpen, buildInitialForm]);

  // Assignee picker: Unassigned + every group member (default = whoever opened it).
  const assigneeOptions = useMemo<PickerOption[]>(
    () => [
      { value: '', primary: 'Unassigned' },
      ...groupMembers.map((m) => ({ value: m.user_id, primary: memberLabel(m.user_id, memberProfiles) })),
    ],
    [groupMembers, memberProfiles]
  );

  // Moving the date keeps a picked repeat on the same pattern ("Weekly on
  // Sunday" becomes "Weekly on Monday"); a custom rule stays as it is.
  const setDue = (due_date: string) =>
    setFormData((f) => ({
      ...f,
      due_date,
      repeat: repeatFollowDue(f.repeat, f.due_date || null, due_date || null, todayISO(), rules),
    }));

  const handleSubmit = () => {
    if (!formData.title.trim()) return;

    // A repeating task with no date starts on its rule's first day.
    const { due_date, ...repeat } = repeatSaveFields(formData.repeat, formData.due_date || null, todayISO());
    // Time only makes sense with a date — drop it if the date was cleared (FLUX-144).
    const due_time = due_date ? formData.due_time || null : null;
    const title = formData.title.trim();
    const assigned_to = formData.assigned_to || null;
    const notes = formData.notes.trim() || null;
    const priority = formData.priority;

    if (task?.id) {
      // Edit path: spread the existing task and overlay the changes.
      // Detach from the moving template when the user changes the date by hand
      // (FLUX-142). Only moving-template tasks carry offset_days.
      const detach =
        task.template_key != null && task.offset_days != null && due_date !== task.due_date;
      onSave({
        ...task,
        title,
        due_date,
        due_time,
        ...repeat,
        assigned_to,
        priority,
        notes,
        ...(detach ? { template_key: null, offset_days: null } : {}),
      });
    } else {
      // New task path: generate a stable ID so the parent can pin it immediately.
      // null timestamps signal INSERT to Legend's CRUD plugin (gotcha 5).
      onSave({
        id: crypto.randomUUID(),
        group_id: groupId,
        title,
        due_date,
        due_time,
        ...repeat,
        assigned_to,
        priority,
        notes,
        done: false,
        completed_at: null,
        private: false,
        template_key: null,
        offset_days: null,
        sort_order: 0,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }

    onClose();
  };

  const handleDelete = () => {
    if (!task?.id || !onDelete) return;
    onDelete(task.id);
    onClose();
  };

  return (
    <ItemFormSheet
      section={HOUSEHOLD_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={task ? 'Edit task' : 'Add to-do'}
      previewContent={
        task ? (
          <>
            <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
              {formData.title || 'Untitled task'}
            </span>
            {formData.due_date && (
              <span className="shrink-0 truncate text-xs text-muted-foreground max-w-24">{dueDayLabel(formData.due_date)}</span>
            )}
            <span className={cn('shrink-0 text-xs font-medium', PRIORITY_WORD[formData.priority])}>
              {PRIORITY_LABEL[formData.priority]}
            </span>
          </>
        ) : undefined
      }
      onSubmit={handleSubmit}
      canSubmit={!!formData.title.trim()}
      onDelete={task && onDelete ? handleDelete : undefined}
      deleteConfirmTitle={task ? `Delete "${task.title}"?` : undefined}
    >
      <FormSection>
        <FieldRow label="Task" htmlFor="task-title" required>
          <Input
            id="task-title"
            autoFocus
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Change electricity over"
          />
        </FieldRow>

        <FieldRow
          label="Due date"
          action={
            formData.due_date ? (
              <button
                type="button"
                onClick={() => setDue('')}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            ) : undefined
          }
        >
          {/* Quick shortcuts — set the date without spinning the picker (FLUX-142). */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              { label: 'Today', value: todayISO() },
              { label: 'Tomorrow', value: addDaysISO(todayISO(), 1) },
              { label: 'Next week', value: addDaysISO(todayISO(), 7) },
            ].map((chip) => {
              const active = formData.due_date === chip.value;
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setDue(chip.value)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          <div className="py-2">
            <DateScrollField
              value={formData.due_date}
              onChange={(v) => setDue(v)}
            />
          </div>
        </FieldRow>

        {/* Time of day — optional, only meaningful once a date is set (FLUX-144). */}
        {formData.due_date && (
          <FieldRow
            label="Time"
            action={
              formData.due_time ? (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, due_time: '' })}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear time
                </button>
              ) : undefined
            }
          >
            {formData.due_time ? (
              <div className="py-2">
                <TimeScrollField
                  value={formData.due_time}
                  onChange={(v) => setFormData({ ...formData, due_time: v })}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => setFormData({ ...formData, due_time: '09:00' })}
              >
                + Add a time
              </Button>
            )}
          </FieldRow>
        )}

        <FieldRow label="Priority">
          <PrioritySlider
            value={formData.priority}
            onChange={(priority) => setFormData({ ...formData, priority })}
            ariaLabel="Priority"
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Details">
        <FieldRow label="Assignee">
          <SearchablePicker
            options={assigneeOptions}
            value={formData.assigned_to}
            onChange={(assigned_to) => setFormData({ ...formData, assigned_to })}
            placeholder="Unassigned"
            searchPlaceholder="Search people…"
            ariaLabel="Assignee"
          />
        </FieldRow>

        {/* Recurrence, off by default (FLUX-182); calendar rules like Google's. */}
        <FieldRow label="Repeat">
          <RepeatField
            value={formData.repeat}
            dueDate={formData.due_date || null}
            rules={rules}
            onChange={(repeat) => setFormData((f) => ({ ...f, repeat }))}
          />
        </FieldRow>
      </FormSection>

      <FormSection>
        <FieldRow label="Notes">
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
            placeholder="Any additional details..."
            rows={3}
          />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
