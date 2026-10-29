// The task editor's Repeat field on the phone (option A, Google Calendar
// style): a list built from the due date, a Custom builder for any other
// rule, and a "Next:" line to check it. The list, the builder's state and the
// wording are core's (repeat-editor.ts). Web twin:
// apps/web/src/app/tasks/repeat-field.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native';
import { Text, DateScrollField, DragNumberField, SegmentedControl, cn, haptics } from '@homeup/ui';
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

interface RepeatFieldProps {
  value: TaskRepeatFields;
  dueDate: string | null;
  /** False on a server without calendar rules: the old day-count list, no Custom. */
  rules: boolean;
  onChange: (value: TaskRepeatFields) => void;
}

export function RepeatField({ value, dueDate, rules, onChange }: RepeatFieldProps) {
  const today = todayISO();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<RepeatDraft | null>(null);
  const choices = React.useMemo(() => repeatChoices(dueDate, today, rules), [dueDate, today, rules]);
  const selected = selectedRepeatChoice(value, choices);
  const preview = repeatPreview(value, dueDate, today);
  const custom = selected === null && !!value.recurrence_days;

  const pick = (next: TaskRepeatFields) => {
    haptics.select();
    onChange(next);
    setDraft(null);
    setOpen(false);
  };
  const openCustom = () => {
    haptics.select();
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
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Repeat: ${repeatValueLabel(value)}`}
        onPress={() => setOpen((o) => !o)}
        className="h-11 flex-row items-center gap-2 rounded-lg border border-input bg-background px-3"
      >
        <Text
          numberOfLines={1}
          className={cn('flex-1 text-sm', value.recurrence_days ? 'text-foreground' : 'text-muted-foreground')}
        >
          {repeatValueLabel(value)}
        </Text>
        <ChevronDown size={16} className="text-muted-foreground" style={open ? { transform: [{ rotate: '180deg' }] } : undefined} />
      </Pressable>

      {open && (
        <View accessibilityRole="list">
          {choices.map((c) => {
            const on = selected === c.id && !draft;
            return (
              <ChoiceRow key={c.id} label={c.label} on={on} onPress={() => pick(c.patch)} />
            );
          })}
          {rules && <ChoiceRow label="Custom" on={custom} onPress={openCustom} more />}
        </View>
      )}

      {draft && <CustomBuilder draft={draft} dueDate={dueDate} today={today} onChange={editDraft} />}

      {preview.length > 0 && (
        <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          Next: {preview.map((d) => repeatDateLabel(d, today)).join(', ')}
        </Text>
      )}
    </View>
  );
}

function ChoiceRow({ label, on, onPress, more }: { label: string; on: boolean; onPress: () => void; more?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      className={cn('min-h-11 flex-row items-center gap-2 rounded-md px-2', on && 'bg-primary/10')}
    >
      <View style={{ width: 16 }}>{on && <Check size={16} className="text-primary" />}</View>
      <Text className={cn('flex-1 text-sm text-foreground', on && 'font-medium')}>{label}</Text>
      {more && <ChevronRight size={16} className="text-muted-foreground" />}
    </Pressable>
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
    <View className="gap-3 pt-1">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm text-muted-foreground">Every</Text>
        <DragNumberField
          value={draft.interval}
          onChange={(v) => onChange({ interval: v != null && v > 0 ? v : 1 })}
          min={1}
          max={99}
          className="w-20"
        />
        <SegmentedControl options={REPEAT_UNIT_OPTIONS} value={draft.unit} onChange={(unit) => onChange({ unit })} size="sm" />
      </View>

      {draft.unit === 'week' && (
        <View className="flex-row gap-1.5" accessibilityLabel="On these days">
          {REPEAT_WEEKDAY_OPTIONS.map((d) => {
            const on = draft.weekDays.includes(d.value);
            return (
              <Pressable
                key={d.value}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={d.name}
                onPress={() => {
                  haptics.select();
                  onChange({ weekDays: on ? draft.weekDays.filter((x) => x !== d.value) : [...draft.weekDays, d.value] });
                }}
                className={cn('h-9 w-9 items-center justify-center rounded-full', on ? 'bg-primary' : 'bg-muted')}
              >
                <Text className={cn('text-xs font-medium', on ? 'text-primary-foreground' : 'text-muted-foreground')}>
                  {d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {(draft.unit === 'month' || draft.unit === 'year') && (
        <View className="gap-1">
          <Text className="text-xs text-muted-foreground">On</Text>
          <SegmentedControl options={monthModes} value={draft.monthMode} onChange={(monthMode) => onChange({ monthMode })} size="sm" wrap />
        </View>
      )}

      <View className="gap-1">
        <Text className="text-xs text-muted-foreground">Ends</Text>
        <SegmentedControl options={REPEAT_END_OPTIONS} value={draft.end} onChange={(end) => onChange({ end })} size="sm" />
        {draft.end === 'until' && (
          <View className="rounded-lg border border-border bg-muted/30 py-2">
            <DateScrollField value={draft.until} onChange={(until) => onChange({ until })} />
          </View>
        )}
        {draft.end === 'count' && (
          <View className="flex-row items-center gap-2 pt-1">
            <DragNumberField
              value={draft.count}
              onChange={(v) => onChange({ count: v != null && v > 0 ? v : 1 })}
              min={1}
              max={999}
              className="w-20"
            />
            <Text className="text-sm text-muted-foreground">times</Text>
          </View>
        )}
      </View>
    </View>
  );
}
