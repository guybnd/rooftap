// HOUP-87: the calendar's 24h Day grid — positions appointments and group
// events via @homeup/core's computeOverlapLayout/computeEventOverlapLayout
// (the same column-packing math apps/web/src/app/calendar/page.tsx's
// renderDayColumn uses). Tasks never render on the grid on web either
// (renderDayColumn doesn't reference them) — they're Agenda-only, see
// agenda-list.tsx.
//
// Slot long-press uses RN's built-in Pressable.onLongPress rather than
// react-native-gesture-handler's Gesture.LongPress: it composes with the
// enclosing vertical ScrollView for free via RN's native responder system
// (the same way every other Pressable/ListItem in this codebase already
// does), where a hand-rolled reanimated gesture would need extra
// simultaneous-handler plumbing to not fight the scroll — plumbing that
// can't be verified without an on-device smoke pass. Card taps are plain
// Pressables layered above the grid background, so RN's responder system
// already resolves "tap the card" vs "long-press the empty grid" the same
// way apps/web's onClick + e.stopPropagation() does.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Building2 } from 'lucide-react-native';
import {
  computeCalendarOverlapLayout,
  computeEventOverlapLayout,
  computeOverlapLayout,
  isEventStartDay,
  type Apartment,
  type Appointment,
  type GoogleCalendarEventWithAttribution,
  type GroupEvent,
} from '@homeup/core';
import { Text, cn, haptics } from '@homeup/ui';

/** Mirrors apps/web/src/app/calendar/page.tsx's getCalendarEventClasses. H2: a
    suggestion is a nudge (dashed amber edge: it isn't yours yet); a shared
    event is told by its dashed neutral edge, not by teal, which is for
    controls. Text stays foreground (calendarEventTextClasses) so it reads on
    both grounds. */
export function calendarEventClasses(ev: GoogleCalendarEventWithAttribution): string {
  if (ev.state === 'suggested') return 'bg-warning/10 border border-dashed border-warning/60';
  if (ev.sharedByUserId) return 'bg-card border border-dashed border-border';
  return 'bg-secondary border border-border';
}
export function calendarEventTextClasses(ev: GoogleCalendarEventWithAttribution): string {
  if (ev.state === 'suggested' || ev.sharedByUserId) return 'text-foreground';
  return 'text-secondary-foreground';
}

// A group event's colour, by category. Spelled out here rather than read
// from core's EVENT_CATEGORY_META: NativeWind only builds classes it finds in
// this app and packages/ui, so core's strings never existed on the phone and
// every block rendered as a bare outline. Text stays foreground (RN Text never
// inherits a View's colour).
const EVENT_BLOCK_CLASSES: Record<string, string> = {
  general: 'bg-slate-500/30 border-slate-400/40 border-l-slate-400',
  medical: 'bg-rose-500/30 border-rose-400/40 border-l-rose-400',
  social: 'bg-fuchsia-500/30 border-fuchsia-400/40 border-l-fuchsia-400',
  household: 'bg-teal-500/30 border-teal-400/40 border-l-teal-400',
  finance: 'bg-amber-500/30 border-amber-400/40 border-l-amber-400',
  school: 'bg-indigo-500/30 border-indigo-400/40 border-l-indigo-400',
  travel: 'bg-sky-500/30 border-sky-400/40 border-l-sky-400',
  work: 'bg-orange-500/30 border-orange-400/40 border-l-orange-400',
};

/** A group event's fill and border: a tinted block with a solid left edge. */
export function groupEventClasses(category: string): string {
  return cn('border border-l-[3px]', EVENT_BLOCK_CLASSES[category] ?? EVENT_BLOCK_CLASSES.general);
}

/** Just the fill, for small marks (the month grid's bars). */
export function groupEventFillClasses(category: string): string {
  return (EVENT_BLOCK_CLASSES[category] ?? EVENT_BLOCK_CLASSES.general).split(' ')[0];
}

// A timed block shorter than this shows its time and title on one line, so a
// 20-minute viewing never clips to just "4:00 PM" (web's COMPACT_BLOCK_PX).
const COMPACT_BLOCK_PX = 40;
// Tall enough for a third line: an event's place under its title.
const DETAIL_BLOCK_PX = 52;

/** One timed block's text: time over title (over its place, when there's
    room), or time and title on one line when the block is too short for two. */
function BlockText({
  time,
  title,
  detail,
  height,
  textClassName,
}: {
  time: string;
  title: string;
  detail?: string | null;
  height: number;
  textClassName: string;
}) {
  if (height < COMPACT_BLOCK_PX) {
    return (
      <Text numberOfLines={1} className={cn('text-xs', textClassName)}>
        <Text className="font-semibold text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {time}
        </Text>
        <Text className="font-medium"> {title}</Text>
      </Text>
    );
  }
  return (
    <>
      <Text
        numberOfLines={1}
        className="text-[11px] font-semibold text-muted-foreground"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {time}
      </Text>
      <Text numberOfLines={1} className={cn('text-sm font-medium', textClassName)}>
        {title}
      </Text>
      {detail && height >= DETAIL_BLOCK_PX ? (
        <Text numberOfLines={1} className="text-[11px] text-muted-foreground">
          {detail}
        </Text>
      ) : null}
    </>
  );
}

export const SLOT_HEIGHT = 56;
const SLOTS_PER_HOUR = 4;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function formatHour(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h} ${ampm}`;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// A small top inset applied to the whole grid so whichever hour row the
// index screen's auto-scroll-to-current-time lands on always has breathing
// room above its label — without it the scrolled-to row's label sits flush
// against the ScrollView's top edge and reads as clipped.
const GRID_TOP_INSET = 8;

interface DayGridProps {
  day: Date;
  appointments: Appointment[];
  apartments: Apartment[];
  durationMinutes: number;
  groupEvents: GroupEvent[];
  /** Google Calendar overlay events for this day (HOUP-100) — omit/empty when not connected. */
  calendarEvents?: GoogleCalendarEventWithAttribution[];
  onPressAppointment: (appointment: Appointment) => void;
  onPressEvent: (event: GroupEvent) => void;
  onPressCalendarEvent?: (event: GoogleCalendarEventWithAttribution) => void;
  onLongPressSlot: (at: Date) => void;
}

export function DayGrid({
  day,
  appointments,
  apartments,
  durationMinutes,
  groupEvents,
  calendarEvents = [],
  onPressAppointment,
  onPressEvent,
  onPressCalendarEvent,
  onLongPressSlot,
}: DayGridProps) {
  // A multi-day/spanning event keeps its timed block on its start day only —
  // every other day it spans renders in the all-day band instead (FLUX-259 /
  // HOUP-112), matching apps/web's renderDayColumn.
  // All-day items render in AllDayBand above the scrolling grid (so they stay
  // in view when the grid opens on the afternoon), never at its midnight edge.
  const timedEvents = groupEvents.filter((ev) => !ev.is_all_day && isEventStartDay(ev, day));
  const appointmentLayout = computeOverlapLayout(appointments, durationMinutes);
  const eventLayout = computeEventOverlapLayout(timedEvents);
  const calendarLayout = computeCalendarOverlapLayout(calendarEvents);

  const now = new Date();
  const isToday = isSameDay(day, now);
  const nowTop = (now.getHours() + now.getMinutes() / 60) * SLOT_HEIGHT;

  const handleLongPress = (e: { nativeEvent: { locationY: number } }) => {
    const y = e.nativeEvent.locationY;
    const slot = Math.max(0, Math.min(24 * SLOTS_PER_HOUR - 1, Math.floor(y / (SLOT_HEIGHT / SLOTS_PER_HOUR))));
    const hour = Math.floor(slot / SLOTS_PER_HOUR);
    const minute = (slot % SLOTS_PER_HOUR) * 15;
    haptics.commit();
    onLongPressSlot(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute));
  };

  return (
    <View className="flex-row" style={{ paddingTop: GRID_TOP_INSET }}>
      <View style={{ width: 44 }}>
        {HOURS.map((h) => (
          <View key={h} style={{ height: SLOT_HEIGHT }} className="items-end pr-1.5 pt-0.5">
            <Text className="text-[10px] text-muted-foreground">{formatHour(h)}</Text>
          </View>
        ))}
      </View>

      <Pressable
        className={`relative flex-1 border-l border-border/60 ${isToday ? 'bg-foreground/[0.025]' : ''}`}
        delayLongPress={500}
        onLongPress={handleLongPress}
      >
        {/* HOUP-296: was bg-destructive — red reads as "error", not a time
            indicator, and is off the interactive-gilt/status-red lanes under
            Axis Mundi. A neutral foreground hairline marks "now" instead. */}
        {isToday && (
          <View pointerEvents="none" className="absolute left-0 right-0 z-30 h-px bg-foreground/60" style={{ top: nowTop }} />
        )}

        {HOURS.map((h) => (
          <View
            key={h}
            className="absolute left-0 right-0 border-t border-border/40"
            style={{ top: h * SLOT_HEIGHT, height: SLOT_HEIGHT }}
          />
        ))}

        {calendarLayout.map(({ event: ev, start, end, col, totalCols }) => {
          const top = start * SLOT_HEIGHT + 1;
          const height = Math.max((end - start) * SLOT_HEIGHT - 2, 28);
          const widthPercent = 100 / totalCols;
          return (
            <Pressable
              key={ev.id}
              onPress={() => onPressCalendarEvent?.(ev)}
              accessibilityRole="button"
              className={`absolute z-10 overflow-hidden rounded-md px-1.5 py-1 ${calendarEventClasses(ev)}`}
              style={{ top, height, left: `${col * widthPercent}%`, width: `${widthPercent}%` }}
            >
              <BlockText
                time={formatClock(new Date(ev.starts_at))}
                title={ev.title || 'Untitled event'}
                height={height}
                textClassName={calendarEventTextClasses(ev)}
              />
            </Pressable>
          );
        })}

        {eventLayout.map(({ event: ev, start, end, col, totalCols }) => {
          const top = start * SLOT_HEIGHT + 1;
          const height = Math.max((end - start) * SLOT_HEIGHT - 2, 28);
          const widthPercent = 100 / totalCols;
          return (
            <Pressable
              key={ev.id}
              onPress={() => onPressEvent(ev)}
              accessibilityRole="button"
              className={cn('absolute z-10 overflow-hidden rounded-md px-1.5 py-1', groupEventClasses(ev.category))}
              style={{ top, height, left: `${col * widthPercent}%`, width: `${widthPercent}%` }}
            >
              <BlockText
                time={formatClock(new Date(ev.starts_at))}
                title={ev.title}
                detail={ev.location}
                height={height}
                textClassName="text-foreground"
              />
            </Pressable>
          );
        })}

        {appointmentLayout.map(({ app, start, end, col, totalCols }) => {
          const apt = apartments.find((a) => a.id === app.apartment_id);
          if (!apt) return null;
          const top = start * SLOT_HEIGHT + 1;
          const height = Math.max((end - start) * SLOT_HEIGHT - 2, 28);
          const widthPercent = 100 / totalCols;
          const muted = app.status === 'skipped' || app.status === 'rebook';
          const optional = app.status === 'optional';
          const time = formatClock(new Date(app.scheduled_at));
          return (
            // A viewing is a neutral card in the grid (H2: teal is for
            // controls, amber for status words). An optional one is told by
            // its dashed edge, a skipped one by the done treatment (web's
            // renderDayColumn draws the same).
            <Pressable
              key={app.id}
              onPress={() => onPressAppointment(app)}
              accessibilityRole="button"
              accessibilityLabel={`Viewing, ${time}, ${apt.address}`}
              className={cn(
                'absolute z-20 overflow-hidden rounded-md border bg-card px-1.5 py-1',
                muted ? 'border-border opacity-55' : optional ? 'border-dashed border-muted-foreground/50' : 'border-border'
              )}
              style={{ top, height, left: `${col * widthPercent}%`, width: `${widthPercent}%` }}
            >
              {height < COMPACT_BLOCK_PX ? (
                <BlockText
                  time={time}
                  title={apt.address}
                  height={height}
                  textClassName={cn('text-foreground', muted && 'line-through')}
                />
              ) : (
                <>
                  <View className="flex-row items-center gap-1">
                    <Building2 size={12} className="text-muted-foreground" />
                    <Text
                      numberOfLines={1}
                      className={cn('text-[11px] font-semibold text-muted-foreground', muted && 'line-through')}
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      {time}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    className={cn('text-sm font-medium text-foreground', muted && 'line-through')}
                  >
                    {apt.address}
                  </Text>
                  {apt.suburb && (
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {apt.suburb}
                    </Text>
                  )}
                </>
              )}
            </Pressable>
          );
        })}
      </Pressable>
    </View>
  );
}

interface AllDayBandProps {
  day: Date;
  groupEvents: GroupEvent[];
  calendarEvents?: GoogleCalendarEventWithAttribution[];
  onPressEvent: (event: GroupEvent) => void;
  onPressCalendarEvent?: (event: GoogleCalendarEventWithAttribution) => void;
}

/** The day's all-day items: Google all-day events, all-day group events, and
    the later days of a multi-day event (its timed block stays on its start
    day, FLUX-259). Rendered above the scrolling DayGrid so they stay in view
    when the grid opens on the afternoon (web's mobile all-day band). Renders
    nothing on a day without any (H: hide empty chrome). */
export function AllDayBand({ day, groupEvents, calendarEvents = [], onPressEvent, onPressCalendarEvent }: AllDayBandProps) {
  const allDayCalendarEvents = calendarEvents.filter((ev) => ev.is_all_day);
  const allDayEvents = groupEvents.filter((ev) => ev.is_all_day || !isEventStartDay(ev, day));
  if (allDayCalendarEvents.length === 0 && allDayEvents.length === 0) return null;

  return (
    <View className="flex-row gap-2 border-b border-border/60 px-4 py-2">
      <Text className="w-10 pt-1 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        All day
      </Text>
      <View className="flex-1 gap-1">
        {allDayCalendarEvents.map((ev) => (
          <Pressable
            key={ev.id}
            onPress={() => onPressCalendarEvent?.(ev)}
            accessibilityRole="button"
            className={`min-h-7 justify-center rounded-md px-2 py-1 ${calendarEventClasses(ev)}`}
          >
            <Text numberOfLines={1} className={`text-xs font-medium ${calendarEventTextClasses(ev)}`}>
              {ev.title || 'Untitled event'}
            </Text>
          </Pressable>
        ))}
        {allDayEvents.map((ev) => (
          <Pressable
            key={ev.id}
            onPress={() => onPressEvent(ev)}
            accessibilityRole="button"
            className={cn('min-h-7 justify-center rounded-md px-2 py-1', groupEventClasses(ev.category))}
          >
            <Text numberOfLines={1} className="text-xs font-medium text-foreground">
              {ev.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
