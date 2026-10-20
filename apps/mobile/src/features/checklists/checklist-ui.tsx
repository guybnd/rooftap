// Hearth (H2/H6, no emoji in chrome): the checklist type glyphs and date
// labels every native Checklists screen shares (list, detail, new,
// templates). Mirrors apps/web/src/app/checklists/checklist-ui.tsx: the same
// Lucide icons for each type, the same relative-date grammar.
import * as React from 'react';
import { View } from 'react-native';
import { ListTodo, Repeat, ShoppingCart, type LucideIcon } from 'lucide-react-native';
import { daysBetweenISO, dueDayLabel, todayISO, type ChecklistType } from '@homeup/core';
import { cn } from '@homeup/ui';

const TYPE_ICON: Record<ChecklistType, LucideIcon> = {
  plain: ListTodo,
  repeating: Repeat,
  shopping: ShoppingCart,
};

export function checklistTypeIcon(type: ChecklistType | null | undefined): LucideIcon {
  return (type && TYPE_ICON[type]) || ListTodo;
}

export type ScheduledTone = 'danger' | 'warning' | 'muted';

/**
 * H6: a scheduled date as a relative label, the same grammar as a task's due
 * date: "3d overdue", Today, Tomorrow, a weekday inside the coming week, then
 * a short date. Never raw ISO. `long` (a property row with room) spells the
 * weekday out and adds the weekday to a further date.
 */
export function scheduledDateMeta(
  dateISO: string,
  { long = false, today = todayISO() }: { long?: boolean; today?: string } = {}
): { label: string; tone: ScheduledTone } {
  const diff = daysBetweenISO(today, dateISO);
  const tone: ScheduledTone = diff < 0 ? 'danger' : diff <= 1 ? 'warning' : 'muted';
  // Short form is core's dueDayLabel, the task rows' grammar; the long form
  // only spells out a date that is two or more days away.
  if (!long || diff <= 1) return { label: dueDayLabel(dateISO, today), tone };
  const date = new Date(`${dateISO}T00:00:00`);
  const label =
    diff < 7
      ? date.toLocaleDateString('en-US', { weekday: 'long' })
      : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return { label, tone };
}

export const SCHEDULED_TONE_CLASS: Record<ScheduledTone, string> = {
  danger: 'text-destructive',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
};

/** H3: progress scoped to the row it measures, ~52px x 3px, never edge to edge. */
export function InlineMeter({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
      className={cn('h-[3px] w-[52px] shrink-0 overflow-hidden rounded-full bg-muted', className)}
    >
      <View className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </View>
  );
}
