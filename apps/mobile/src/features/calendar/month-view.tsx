// The calendar's Month view: a 6 x 7 grid where each day shows up to two of
// its items as small bars and a "+n" for the rest. Tapping a day picks it;
// the screen lists that day's agenda under the grid.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import {
  getEventsForDay,
  monthGridDays,
  type Appointment,
  type GoogleCalendarEventWithAttribution,
  type GroupEvent,
} from '@homeup/core';
import { Text, cn, haptics } from '@homeup/ui';
import { groupEventFillClasses } from './day-grid';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SHOWN = 2;

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Bar = { key: string; title: string; className: string };

interface MonthViewProps {
  month: Date;
  selectedDay: Date;
  appointments: Appointment[];
  groupEvents: GroupEvent[];
  calendarEvents: GoogleCalendarEventWithAttribution[];
  /** Due to-dos count toward a day's "+n" but never take a bar. */
  taskCountFor: (day: Date) => number;
  onPressDay: (day: Date) => void;
}

export function MonthView({ month, selectedDay, appointments, groupEvents, calendarEvents, taskCountFor, onPressDay }: MonthViewProps) {
  const today = new Date();
  const days = monthGridDays(month);

  const barsFor = (day: Date): Bar[] => [
    ...calendarEvents
      .filter((ev) => isSameDay(new Date(ev.starts_at), day))
      .map((ev) => ({ key: `g-${ev.id}`, title: ev.title || 'Untitled event', className: 'bg-secondary' })),
    ...getEventsForDay(groupEvents, day).map((ev) => ({
      key: `e-${ev.id}`,
      title: ev.title,
      className: groupEventFillClasses(ev.category),
    })),
    ...appointments
      .filter((a) => isSameDay(new Date(a.scheduled_at), day))
      .map((a) => ({ key: `a-${a.id}`, title: 'Viewing', className: 'border border-border bg-card' })),
  ];

  return (
    <View className="px-2">
      <View className="flex-row">
        {WEEKDAY_LABELS.map((w, i) => (
          <View key={i} className="flex-1 items-center py-1">
            <Text className="text-[10px] font-medium text-muted-foreground">{w}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row flex-wrap">
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const selected = isSameDay(day, selectedDay);
          const isToday = isSameDay(day, today);
          const bars = barsFor(day);
          const more = Math.max(0, bars.length - SHOWN) + taskCountFor(day);
          return (
            <Pressable
              key={day.toDateString()}
              onPress={() => {
                if (!selected) haptics.select();
                onPressDay(day);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${
                bars.length ? `, ${bars.length} on` : ''
              }`}
              style={{ width: `${100 / 7}%`, height: 64 }}
              className={cn('gap-0.5 rounded-lg p-0.5', selected && 'bg-primary/15', !inMonth && 'opacity-40')}
            >
              <View
                className={cn(
                  'h-5 w-5 items-center justify-center self-center rounded-full',
                  isToday && !selected && 'border border-border'
                )}
              >
                <Text
                  className={cn('text-xs font-semibold', selected ? 'text-primary' : 'text-foreground')}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {day.getDate()}
                </Text>
              </View>
              {bars.slice(0, SHOWN).map((bar) => (
                <View key={bar.key} className={cn('rounded-sm px-0.5', bar.className)}>
                  <Text numberOfLines={1} className="text-[8.5px] font-medium text-foreground">
                    {bar.title}
                  </Text>
                </View>
              ))}
              {more > 0 && <Text className="text-center text-[8.5px] text-muted-foreground">+{more}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
