// HOUP-81: universal port of apps/web/src/components/date-scroll-field.tsx —
// same day/month/year ScrollField trio, same timezone-safe YYYY-MM-DD
// contract, built on the universal ScrollField above instead of the DOM-only
// original.
import * as React from 'react';
import { Text, View } from 'react-native';
import { ScrollField, ScrollFieldRow } from './scroll-field';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function toISO(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export interface DateScrollFieldProps {
  /** YYYY-MM-DD, or '' for no date (the spinner seeds from today). */
  value: string;
  onChange: (value: string) => void;
  /** Selectable year bounds (defaults: current-1 .. current+5). */
  minYear?: number;
  maxYear?: number;
  /** Readout shown for value === ''. Defaults to the due-date wording every existing caller expects. */
  emptyLabel?: string;
}

export function DateScrollField({ value, onChange, minYear, maxYear, emptyLabel }: DateScrollFieldProps) {
  const today = new Date();

  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = parsed ? Number(parsed[1]) : today.getFullYear();
  const month = parsed ? Number(parsed[2]) - 1 : today.getMonth();
  const day = parsed ? Number(parsed[3]) : today.getDate();

  const loYear = minYear ?? today.getFullYear() - 1;
  const hiYear = maxYear ?? today.getFullYear() + 5;
  const maxDay = daysInMonth(year, month);
  const clampedDay = Math.min(day, maxDay);

  const emit = (y: number, m: number, d: number) => onChange(toISO(y, m, Math.min(d, daysInMonth(y, m))));

  const readout = parsed
    ? new Date(year, month, clampedDay).toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : (emptyLabel ?? 'No due date. Spin or tap a shortcut to set one');

  return (
    <View className="items-center gap-1">
      <ScrollFieldRow>
        <ScrollField value={clampedDay} onChange={(d) => emit(year, month, d)} min={1} max={maxDay} label="Day" />
        <ScrollField
          value={month}
          onChange={(m) => emit(year, m, day)}
          min={0}
          max={11}
          label="Month"
          display={MONTHS[month]}
          wide
        />
        <ScrollField value={year} onChange={(y) => emit(y, month, day)} min={loYear} max={hiYear} label="Year" pad={4} wide />
      </ScrollFieldRow>
      <Text className={`text-center text-xs ${parsed ? 'text-foreground' : 'text-muted-foreground'}`}>{readout}</Text>
    </View>
  );
}
