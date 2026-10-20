// HOUP-81: universal port of apps/web/src/components/time-scroll-field.tsx —
// same hour + 5-minute-step ScrollField pair, same "HH:MM" 24h contract.
import * as React from 'react';
import { Text, View } from 'react-native';
import { ScrollField, ScrollFieldRow } from './scroll-field';

function parse(value: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (match) return { h: Number(match[1]), m: Number(match[2]) };
  return { h: 9, m: 0 };
}

function to24(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function display12(h: number, m: number) {
  const period = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${period}`;
}

export interface TimeScrollFieldProps {
  /** 24h "HH:MM" (or "HH:MM:SS"); seeds to 9:00 when unset. */
  value: string;
  onChange: (value: string) => void;
}

export function TimeScrollField({ value, onChange }: TimeScrollFieldProps) {
  const { h, m } = parse(value);
  return (
    <View className="items-center gap-1">
      <ScrollFieldRow>
        <ScrollField value={h} onChange={(nh) => onChange(to24(nh, m))} min={0} max={23} label="Hour" />
        <View className="mt-2 self-start">
          <Text className="font-bold text-muted-foreground">:</Text>
        </View>
        <ScrollField value={m} onChange={(nm) => onChange(to24(h, nm))} min={0} max={55} step={5} label="Min" />
      </ScrollFieldRow>
      <Text className="text-center text-xs text-foreground">{display12(h, m)}</Text>
    </View>
  );
}
