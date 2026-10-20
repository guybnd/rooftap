"use client";

import { ScrollField } from "@/components/scroll-field";

// Drag/scroll/tap date spinner — the date-only counterpart to the time spinner
// in the appointment modal, built on the same ScrollField (wheel + pointer-drag
// + chevrons + haptics). Emits timezone-safe YYYY-MM-DD strings so it slots in
// wherever a native <input type="date"> was used without changing date math.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function toISO(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

interface DateScrollFieldProps {
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

  // Seed the spinner from the current value, falling back to today when empty.
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = parsed ? Number(parsed[1]) : today.getFullYear();
  const month = parsed ? Number(parsed[2]) - 1 : today.getMonth();
  const day = parsed ? Number(parsed[3]) : today.getDate();

  const loYear = minYear ?? today.getFullYear() - 1;
  const hiYear = maxYear ?? today.getFullYear() + 5;
  const maxDay = daysInMonth(year, month);
  const clampedDay = Math.min(day, maxDay);

  // Any spin emits a concrete date — clamping the day to the (possibly shorter)
  // target month so e.g. Jan 31 → Feb yields Feb 28/29, never an invalid date.
  const emit = (y: number, m: number, d: number) => onChange(toISO(y, m, Math.min(d, daysInMonth(y, m))));

  const readout = parsed
    ? new Date(year, month, clampedDay).toLocaleDateString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : (emptyLabel ?? "No due date. Spin or tap a shortcut to set one");

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-start justify-center gap-1.5 py-1">
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
      </div>
      <div className={`text-center text-xs ${parsed ? "text-foreground" : "text-muted-foreground"}`}>{readout}</div>
    </div>
  );
}
