'use client';

// The task editor's Repeat field (option A, Google Calendar style): a list
// built from the due date, plus a Custom builder for any other rule, and a
// "Next:" line to check the rule before saving. The list, the builder's
// state and the wording are core's (repeat-editor.ts); this lays them out.
// The phone twin is apps/mobile/src/features/tasks/repeat-field.tsx.

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import {
  REPEAT_END_OPTIONS,
  REPEAT_UNIT_OPTIONS,
  REPEAT_WEEKDAY_OPTIONS,
  repeatChoices,
  repeatDateLabel,
  repeatDraftFrom,
  repeatMonthModeOptions,
  repeatPreview,
  repeatRuleFromDraft,
  repeatValueLabel,
  rulePatch,
  selectedRepeatChoice,
  todayISO,
  type RepeatDraft,
  type TaskRepeatFields,
} from '@homeup/core';
import { DateScrollField } from '@/components/date-scroll-field';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

interface RepeatFieldProps {
  value: TaskRepeatFields;
  dueDate: string | null;
  /** False on a server without calendar rules: the old day-count list, no Custom. */
  rules: boolean;
  onChange: (value: TaskRepeatFields) => void;
}

export function RepeatField({ value, dueDate, rules, onChange }: RepeatFieldProps) {
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RepeatDraft | null>(null);
  const choices = useMemo(() => repeatChoices(dueDate, today, rules), [dueDate, today, rules]);
  const selected = selectedRepeatChoice(value, choices);
  const preview = repeatPreview(value, dueDate, today);

  const pick = (next: TaskRepeatFields) => {
    onChange(next);
    setDraft(null);
    setOpen(false);
  };
  const openCustom = () => {
    const start = repeatDraftFrom(value, dueDate, today);
    setDraft(start);
    setOpen(false);
    onChange(rulePatch(repeatRuleFromDraft(start, dueDate, today)));
  };
  const editDraft = (patch: Partial<RepeatDraft>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(rulePatch(repeatRuleFromDraft(next, dueDate, today)));
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-sm"
      >
        <span className={cn('flex-1 truncate', value.recurrence_days ? 'text-foreground' : 'text-muted-foreground')}>
          {repeatValueLabel(value)}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="listbox" aria-label="Repeat" className="flex flex-col py-1">
          {choices.map((c) => {
            const on = selected === c.id && !draft;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => pick(c.patch)}
                className={cn(
                  'flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted',
                  on && 'bg-primary/10 font-medium',
                )}
              >
                <Check className={cn('h-4 w-4 text-primary', !on && 'invisible')} />
                <span className="flex-1">{c.label}</span>
              </button>
            );
          })}
          {rules && (
            <button
              type="button"
              role="option"
              aria-selected={selected === null && !!value.recurrence_days}
              onClick={openCustom}
              className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
            >
              <Check
                className={cn('h-4 w-4 text-primary', !(selected === null && value.recurrence_days) && 'invisible')}
              />
              <span className="flex-1">Custom</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {draft && <CustomBuilder draft={draft} dueDate={dueDate} today={today} onChange={editDraft} />}

      {preview.length > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Next: {preview.map((d) => repeatDateLabel(d, today)).join(', ')}
        </p>
      )}
    </div>
  );
}

function CustomBuilder({
  draft,
  dueDate,
  today,
  onChange,
}: {
  draft: RepeatDraft;
  dueDate: string | null;
  today: string;
  onChange: (patch: Partial<RepeatDraft>) => void;
}) {
  const monthModes = repeatMonthModeOptions(dueDate, today);
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Every</span>
        <DragNumberField
          value={draft.interval}
          onChange={(v) => onChange({ interval: v != null && v > 0 ? v : 1 })}
          step={1}
          min={1}
          max={99}
          precision={0}
          ariaLabel="Repeat every"
          className="w-20"
        />
        <SegmentedControl
          options={REPEAT_UNIT_OPTIONS}
          value={draft.unit}
          onChange={(unit) => onChange({ unit })}
          size="sm"
          ariaLabel="Repeat unit"
        />
      </div>

      {draft.unit === 'week' && (
        <div className="flex gap-1.5" role="group" aria-label="On these days">
          {REPEAT_WEEKDAY_OPTIONS.map((d) => {
            const on = draft.weekDays.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                aria-label={d.name}
                onClick={() =>
                  onChange({
                    weekDays: on ? draft.weekDays.filter((x) => x !== d.value) : [...draft.weekDays, d.value],
                  })
                }
                className={cn(
                  'h-8 w-8 rounded-full text-xs font-medium transition-colors',
                  on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      )}

      {(draft.unit === 'month' || draft.unit === 'year') && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">On</span>
          <SegmentedControl
            options={monthModes}
            value={draft.monthMode}
            onChange={(monthMode) => onChange({ monthMode })}
            size="sm"
            wrap
            ariaLabel="On"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Ends</span>
        <SegmentedControl
          options={REPEAT_END_OPTIONS}
          value={draft.end}
          onChange={(end) => onChange({ end })}
          size="sm"
          ariaLabel="Ends"
        />
        {draft.end === 'until' && (
          <div className="py-2">
            <DateScrollField value={draft.until} onChange={(until) => onChange({ until })} />
          </div>
        )}
        {draft.end === 'count' && (
          <div className="flex items-center gap-2 pt-1">
            <DragNumberField
              value={draft.count}
              onChange={(v) => onChange({ count: v != null && v > 0 ? v : 1 })}
              step={1}
              min={1}
              max={999}
              precision={0}
              ariaLabel="Times"
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">times</span>
          </div>
        )}
      </div>
    </div>
  );
}
