// The calendar's Week view (household feedback: "I want to see the whole
// week... weekly as the default"). Seven narrow day columns over one shared
// hour gutter, the same column-packing math as DayGrid per day. Blocks show
// just their title (a phone's seventh of a screen has no room for more);
// tapping one opens it, tapping a day's header opens that day, and a
// long-press on a column starts something new at that day and time.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  computeCalendarOverlapLayout,
  computeEventOverlapLayout,
  computeOverlapLayout,
  getEventsForDay,
  isEventStartDay,
  type Apartment,
  type Appointment,
  type GoogleCalendarEventWithAttribution,
  type GroupEvent,
} from '@homeup/core';
import { Text, cn, haptics } from '@homeup/ui';
import { calendarEventClasses, calendarEventTextClasses, formatHour, groupEventClasses } from './day-grid';

/** Narrower than DayGrid's 56: a week needs more of the day on screen at once. */
export const WEEK_SLOT_HEIGHT = 44;
const SLOTS_PER_HOUR = 4;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const GUTTER = 34;
const MIN_BLOCK = 18;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** All-day chips shown per day before a "+n". */
const ALL_DAY_SHOWN = 2;

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface WeekViewProps {
  days: Date[];
  selectedDay: Date;
  appointments: Appointment[];
  apartments: Apartment[];
  durationMinutes: number;
  groupEvents: GroupEvent[];
  calendarEvents: GoogleCalendarEventWithAttribution[];
  scrollRef: React.RefObject<ScrollView | null>;
  onPressDay: (day: Date) => void;
  onPressAppointment: (appointment: Appointment) => void;
  onPressEvent: (event: GroupEvent) => void;
  onPressCalendarEvent: (event: GoogleCalendarEventWithAttribution) => void;
  onLongPressSlot: (at: Date) => void;
}

export function WeekView({
  days,
  selectedDay,
  appointments,
  apartments,
  durationMinutes,
  groupEvents,
  calendarEvents,
  scrollRef,
  onPressDay,
  onPressAppointment,
  onPressEvent,
  onPressCalendarEvent,
  onLongPressSlot,
}: WeekViewProps) {
  const today = new Date();
  const columns = days.map((day) => {
    const dayEvents = getEventsForDay(groupEvents, day);
    const dayCalendar = calendarEvents.filter((ev) => isSameDay(new Date(ev.starts_at), day));
    return {
      day,
      allDay: [
        ...dayCalendar.filter((ev) => ev.is_all_day).map((ev) => ({ kind: 'calendar' as const, ev })),
        ...dayEvents.filter((ev) => ev.is_all_day || !isEventStartDay(ev, day)).map((ev) => ({ kind: 'event' as const, ev })),
      ],
      events: computeEventOverlapLayout(dayEvents.filter((ev) => !ev.is_all_day && isEventStartDay(ev, day))),
      calendar: computeCalendarOverlapLayout(dayCalendar.filter((ev) => !ev.is_all_day)),
      viewings: computeOverlapLayout(
        appointments.filter((a) => isSameDay(new Date(a.scheduled_at), day)),
        durationMinutes
      ),
    };
  });
  const hasAllDay = columns.some((c) => c.allDay.length > 0);

  return (
    <View className="flex-1">
      {/* Day headers: tap one to open that day. */}
      <View className="flex-row border-b border-border/60 pb-1.5" style={{ paddingLeft: GUTTER }}>
        {days.map((day) => {
          const selected = isSameDay(day, selectedDay);
          const isToday = isSameDay(day, today);
          return (
            <Pressable
              key={day.toDateString()}
              onPress={() => {
                haptics.select();
                onPressDay(day);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
              className="min-h-11 flex-1 items-center justify-center gap-0.5"
            >
              <Text className={cn('text-[10px] font-medium', isToday ? 'text-primary' : 'text-muted-foreground')}>
                {WEEKDAY_LABELS[day.getDay()]}
              </Text>
              <View
                className={cn(
                  'h-7 w-7 items-center justify-center rounded-full',
                  isToday ? 'bg-primary/15' : selected && 'border border-border'
                )}
              >
                <Text
                  className={cn('text-sm font-semibold', isToday ? 'text-primary' : 'text-foreground')}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {day.getDate()}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {hasAllDay && (
        <View className="flex-row border-b border-border/60 py-1" style={{ paddingLeft: GUTTER }}>
          {columns.map(({ day, allDay }) => (
            <View key={day.toDateString()} className="flex-1 gap-0.5 px-px">
              {allDay.slice(0, ALL_DAY_SHOWN).map((item) =>
                item.kind === 'calendar' ? (
                  <Pressable
                    key={item.ev.id}
                    onPress={() => onPressCalendarEvent(item.ev)}
                    accessibilityRole="button"
                    accessibilityLabel={item.ev.title || 'Untitled event'}
                    className={cn('rounded px-0.5 py-0.5', calendarEventClasses(item.ev))}
                  >
                    <Text numberOfLines={1} className={cn('text-[9px] font-medium', calendarEventTextClasses(item.ev))}>
                      {item.ev.title || 'Untitled event'}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    key={item.ev.id}
                    onPress={() => onPressEvent(item.ev)}
                    accessibilityRole="button"
                    accessibilityLabel={item.ev.title}
                    className={cn('rounded px-0.5 py-0.5', groupEventClasses(item.ev.category))}
                  >
                    <Text numberOfLines={1} className="text-[9px] font-medium text-foreground">
                      {item.ev.title}
                    </Text>
                  </Pressable>
                )
              )}
              {allDay.length > ALL_DAY_SHOWN && (
                <Pressable onPress={() => onPressDay(day)} accessibilityRole="button" accessibilityLabel="Show all">
                  <Text className="text-center text-[9px] text-muted-foreground">+{allDay.length - ALL_DAY_SHOWN}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}>
        <View className="flex-row">
          <View style={{ width: GUTTER }}>
            {HOURS.map((h) => (
              <View key={h} style={{ height: WEEK_SLOT_HEIGHT }} className="items-end pr-1 pt-0.5">
                <Text className="text-[9px] text-muted-foreground">{formatHour(h)}</Text>
              </View>
            ))}
          </View>

          {columns.map(({ day, events, calendar, viewings }) => {
            const isToday = isSameDay(day, today);
            const nowTop = (today.getHours() + today.getMinutes() / 60) * WEEK_SLOT_HEIGHT;
            return (
              <Pressable
                key={day.toDateString()}
                delayLongPress={500}
                onLongPress={(e) => {
                  const slot = Math.max(
                    0,
                    Math.min(24 * SLOTS_PER_HOUR - 1, Math.floor(e.nativeEvent.locationY / (WEEK_SLOT_HEIGHT / SLOTS_PER_HOUR)))
                  );
                  haptics.commit();
                  onLongPressSlot(
                    new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(slot / SLOTS_PER_HOUR), (slot % SLOTS_PER_HOUR) * 15)
                  );
                }}
                className={cn('relative flex-1 border-l border-border/40', isToday && 'bg-foreground/[0.025]')}
                style={{ height: 24 * WEEK_SLOT_HEIGHT }}
              >
                {HOURS.map((h) => (
                  <View
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/40"
                    style={{ top: h * WEEK_SLOT_HEIGHT, height: WEEK_SLOT_HEIGHT }}
                  />
                ))}
                {isToday && (
                  <View pointerEvents="none" className="absolute left-0 right-0 z-30 h-px bg-foreground/60" style={{ top: nowTop }} />
                )}

                {calendar.map(({ event: ev, start, end, col, totalCols }) => (
                  <Pressable
                    key={ev.id}
                    onPress={() => onPressCalendarEvent(ev)}
                    accessibilityRole="button"
                    accessibilityLabel={ev.title || 'Untitled event'}
                    className={cn('absolute z-10 overflow-hidden rounded px-0.5 py-0.5', calendarEventClasses(ev))}
                    style={blockStyle(start, end, col, totalCols)}
                  >
                    <Text numberOfLines={3} className={cn('text-[9px] font-medium leading-3', calendarEventTextClasses(ev))}>
                      {ev.title || 'Untitled event'}
                    </Text>
                  </Pressable>
                ))}

                {events.map(({ event: ev, start, end, col, totalCols }) => (
                  <Pressable
                    key={ev.id}
                    onPress={() => onPressEvent(ev)}
                    accessibilityRole="button"
                    accessibilityLabel={ev.title}
                    className={cn('absolute z-10 overflow-hidden rounded px-0.5 py-0.5', groupEventClasses(ev.category))}
                    style={blockStyle(start, end, col, totalCols)}
                  >
                    <Text numberOfLines={3} className="text-[9px] font-medium leading-3 text-foreground">
                      {ev.title}
                    </Text>
                  </Pressable>
                ))}

                {viewings.map(({ app, start, end, col, totalCols }) => {
                  const apt = apartments.find((a) => a.id === app.apartment_id);
                  if (!apt) return null;
                  const muted = app.status === 'skipped' || app.status === 'rebook';
                  return (
                    <Pressable
                      key={app.id}
                      onPress={() => onPressAppointment(app)}
                      accessibilityRole="button"
                      accessibilityLabel={`Viewing, ${apt.address}`}
                      className={cn(
                        'absolute z-20 overflow-hidden rounded border bg-card px-0.5 py-0.5',
                        muted ? 'border-border opacity-55' : app.status === 'optional' ? 'border-dashed border-muted-foreground/50' : 'border-border'
                      )}
                      style={blockStyle(start, end, col, totalCols)}
                    >
                      <Text numberOfLines={3} className={cn('text-[9px] font-medium leading-3 text-foreground', muted && 'line-through')}>
                        {apt.address}
                      </Text>
                    </Pressable>
                  );
                })}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function blockStyle(start: number, end: number, col: number, totalCols: number) {
  const widthPercent = 100 / totalCols;
  return {
    top: start * WEEK_SLOT_HEIGHT + 1,
    height: Math.max((end - start) * WEEK_SLOT_HEIGHT - 2, MIN_BLOCK),
    left: `${col * widthPercent}%` as const,
    width: `${widthPercent}%` as const,
  };
}
