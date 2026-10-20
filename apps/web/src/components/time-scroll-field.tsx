"use client";

import { ScrollField } from "@/components/scroll-field";

// Wall-clock time spinner (hour + 5-minute steps) on the same ScrollField as the
// date/appointment pickers. Emits a 24h "HH:MM" string; shows a 12h readout.

function parse(value: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (match) return { h: Number(match[1]), m: Number(match[2]) };
  return { h: 9, m: 0 };
}

function to24(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function display12(h: number, m: number) {
  const period = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}

interface TimeScrollFieldProps {
  /** 24h "HH:MM" (or "HH:MM:SS"); seeds to 9:00 when unset. */
  value: string;
  onChange: (value: string) => void;
}

export function TimeScrollField({ value, onChange }: TimeScrollFieldProps) {
  const { h, m } = parse(value);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-start justify-center gap-1.5 py-1">
        <ScrollField value={h} onChange={(nh) => onChange(to24(nh, m))} min={0} max={23} label="Hour" />
        <div className="self-start mt-2 text-muted-foreground font-bold">:</div>
        <ScrollField value={m} onChange={(nm) => onChange(to24(h, nm))} min={0} max={55} step={5} label="Min" />
      </div>
      <div className="text-center text-xs text-foreground">{display12(h, m)}</div>
    </div>
  );
}
