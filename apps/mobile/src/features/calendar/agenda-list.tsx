// HOUP-87: the calendar's Agenda view for one day — a flat, time-sorted list
// merging appointments, group events, Google Calendar overlay events
// (HOUP-100), and due to-dos, same source data as apps/web/src/app/calendar/
// page.tsx's getAgendaItems.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Building2, Check, CalendarDays, Navigation } from 'lucide-react-native';
import { Text, Button, LeadingTile, ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle } from '@homeup/ui';
import {
  eventDetailLabel,
  legText,
  getEventsForDay,
  isEventStartDay,
  type Apartment,
  type Appointment,
  type GoogleCalendarEventWithAttribution,
  type GroupEvent,
  type HouseholdTask,
  type EventLeg,
} from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';
import { useEventForecast } from './use-event-forecast';
import { useLegTravel } from './use-event-travel';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberLabel(userId: string, profiles: MemberProfiles | undefined): string {
  const profile = profiles?.[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatWallClockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(1970, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export type AgendaItem =
  | { kind: 'appointment'; key: string; sortMinutes: number; timeLabel: string; appointment: Appointment; apartment: Apartment | null }
  | { kind: 'event'; key: string; sortMinutes: number; timeLabel: string; event: GroupEvent }
  | { kind: 'calendarEvent'; key: string; sortMinutes: number; timeLabel: string; calendarEvent: GoogleCalendarEventWithAttribution }
  | { kind: 'task'; key: string; sortMinutes: number; timeLabel: string; task: HouseholdTask };

export function getAgendaItems(
  date: Date,
  appointments: Appointment[],
  apartments: Apartment[],
  groupEvents: GroupEvent[],
  tasks: HouseholdTask[],
  calendarEvents: GoogleCalendarEventWithAttribution[] = []
): AgendaItem[] {
  const items: AgendaItem[] = [];
  const dateKey = toDateKey(date);

  appointments
    .filter((app) => toDateKey(new Date(app.scheduled_at)) === dateKey)
    .forEach((app) => {
      const d = new Date(app.scheduled_at);
      items.push({
        kind: 'appointment',
        key: `apt-${app.id}`,
        sortMinutes: d.getHours() * 60 + d.getMinutes(),
        timeLabel: formatClock(d),
        appointment: app,
        apartment: apartments.find((a) => a.id === app.apartment_id) ?? null,
      });
    });

  // Google Calendar overlay events (HOUP-100) — matched by exact start-day
  // (mirrors apps/web's getCalendarEventsForDay; these never span multiple
  // days the way group events can).
  calendarEvents
    .filter((ev) => toDateKey(new Date(ev.starts_at)) === dateKey)
    .forEach((ev) => {
      const d = new Date(ev.starts_at);
      items.push({
        kind: 'calendarEvent',
        key: `gcal-${ev.id}`,
        sortMinutes: ev.is_all_day ? -1 : d.getHours() * 60 + d.getMinutes(),
        timeLabel: ev.is_all_day ? 'All day' : formatClock(d),
        calendarEvent: ev,
      });
    });

  // Matches any day within an event's [starts_at, ends_at] span, not just its
  // start day, so multi-day events show up on every day they span (FLUX-259 /
  // HOUP-112) — a later spanned day renders as an "All day" row, since only
  // the start day carries a meaningful clock time.
  getEventsForDay(groupEvents, date).forEach((ev) => {
    const allDay = ev.is_all_day || !isEventStartDay(ev, date);
    const d = new Date(ev.starts_at);
    items.push({
      kind: 'event',
      key: `event-${ev.id}`,
      sortMinutes: allDay ? -1 : d.getHours() * 60 + d.getMinutes(),
      timeLabel: allDay ? 'All day' : formatClock(d),
      event: ev,
    });
  });

  tasks
    .filter((t) => t.due_date === dateKey)
    .forEach((t) => {
      const [h, m] = t.due_time ? t.due_time.split(':').map(Number) : [null, null];
      items.push({
        kind: 'task',
        key: `task-${t.id}`,
        sortMinutes: h === null ? -1 : h * 60 + (m ?? 0),
        timeLabel: t.due_time ? formatWallClockTime(t.due_time) : 'All day',
        task: t,
      });
    });

  return items.sort((a, b) => a.sortMinutes - b.sortMinutes);
}

interface AgendaListProps {
  items: AgendaItem[];
  onPressAppointment: (appointment: Appointment) => void;
  onPressEvent: (event: GroupEvent) => void;
  onPressCalendarEvent?: (event: GoogleCalendarEventWithAttribution) => void;
  onPressTask: (task: HouseholdTask) => void;
  onToggleTaskDone: (task: HouseholdTask) => void;
  /** Launches the same "New…" chooser a long-press opens (Hearth E-series). */
  onAddSomething?: () => void;
  /** What the empty state offers to add, e.g. "an event or to-do" (calendarAddPhrase, module-gated). */
  addPhrase?: string;
  /** Names who shared a Google event ("Shared by Maya"). */
  memberProfiles?: MemberProfiles;
  /** Travel between back-to-back events (core eventTravelLegs); each shows on the later event's row. */
  legs?: EventLeg[];
}

/** The row's meta line: its time (mono only for a clock time, T3, never for
    "All day") and, when there is one, a subtitle. Mirrors web's agenda row. */
function AgendaMeta({
  timeLabel,
  subtitle,
  subtitleTone,
}: {
  timeLabel: string;
  subtitle?: string | null;
  subtitleTone?: 'warning';
}) {
  const timed = timeLabel !== 'All day';
  return (
    <ListItemMeta className="flex-nowrap">
      <Text
        className={`text-caption text-muted-foreground ${timed ? 'font-mono' : ''}`}
        style={timed ? { fontVariant: ['tabular-nums'] } : undefined}
      >
        {timeLabel}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} className={`text-caption ${subtitleTone === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}>
          {subtitle}
        </Text>
      ) : null}
    </ListItemMeta>
  );
}

/** The trip from the event before, under an event's meta line, warning-toned when it won't fit the gap. */
function LegLine({ leg }: { leg: EventLeg }) {
  const minutes = useLegTravel(leg);
  if (typeof minutes !== 'number') return null;
  const { text, tight } = legText(leg, minutes);
  return (
    <View className="mt-0.5 flex-row items-center gap-1">
      <Navigation size={11} className={tight ? 'text-warning' : 'text-muted-foreground'} />
      <Text numberOfLines={1} className={`flex-1 text-caption ${tight ? 'text-warning' : 'text-muted-foreground'}`}>
        {text}
      </Text>
    </View>
  );
}

/** An event row's meta line: its place, then the forecast once it's within range. */
function EventAgendaMeta({ timeLabel, event }: { timeLabel: string; event: GroupEvent }) {
  const forecast = useEventForecast(event);
  const detail = eventDetailLabel(event);
  return <AgendaMeta timeLabel={timeLabel} subtitle={forecast ? `${detail} · ${forecast}` : detail} />;
}

export function AgendaList({
  items,
  onPressAppointment,
  onPressEvent,
  onPressCalendarEvent,
  onPressTask,
  onToggleTaskDone,
  onAddSomething,
  addPhrase = 'an appointment, event, or to-do',
  memberProfiles,
  legs,
}: AgendaListProps) {
  if (items.length === 0) {
    return (
      <View className="items-center gap-4 py-12 px-6">
        <View className="rounded-2xl bg-primary/10 p-5">
          <CalendarDays size={28} className="text-primary" />
        </View>
        <View className="items-center gap-1">
          <Text className="text-title font-semibold text-foreground">Nothing scheduled</Text>
          <Text className="text-center text-body text-muted-foreground">
            Long-press a time in Day view, or add {addPhrase}.
          </Text>
        </View>
        {onAddSomething && (
          <Button onPress={onAddSomething}>
            Add something
          </Button>
        )}
      </View>
    );
  }

  // Hearth v2 (§6 feed row): every row leads with its owner section's tile (a
  // viewing wears Home search's, everything else the calendar's), except a
  // to-do, which leads with its checkbox. The time moves into the meta line.
  const CalendarIcon = sectionIconFor('calendar');
  const legOf = (eventId: string) => legs?.find((l) => l.toId === eventId);

  return (
    <ListGroup>
      {items.map((item) => {
        if (item.kind === 'appointment') {
          const status = item.appointment.status;
          const muted = status === 'skipped' || status === 'rebook';
          return (
            <ListItem key={item.key} onPress={() => onPressAppointment(item.appointment)}>
              <ListItemLeading>
                <LeadingTile sectionId="search" Icon={Building2} size="md" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle className={muted ? 'text-muted-foreground line-through' : undefined}>
                  {item.apartment?.address ?? 'Apartment viewing'}
                </ListItemTitle>
                <AgendaMeta
                  timeLabel={item.timeLabel}
                  subtitle={muted ? 'Skipped' : status === 'optional' ? 'Optional' : item.apartment?.suburb}
                />
              </ListItemContent>
            </ListItem>
          );
        }

        if (item.kind === 'event') {
          return (
            <ListItem key={item.key} onPress={() => onPressEvent(item.event)}>
              <ListItemLeading>
                <LeadingTile sectionId="calendar" Icon={CalendarIcon} size="md" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>{item.event.title}</ListItemTitle>
                <EventAgendaMeta timeLabel={item.timeLabel} event={item.event} />
                {legOf(item.event.id) && <LegLine leg={legOf(item.event.id)!} />}
              </ListItemContent>
            </ListItem>
          );
        }

        if (item.kind === 'calendarEvent') {
          const ev = item.calendarEvent;
          return (
            <ListItem key={item.key} onPress={() => onPressCalendarEvent?.(ev)}>
              <ListItemLeading>
                <LeadingTile sectionId="calendar" Icon={CalendarIcon} size="md" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>{ev.title || 'Untitled event'}</ListItemTitle>
                <AgendaMeta
                  timeLabel={item.timeLabel}
                  subtitle={
                    ev.state === 'suggested'
                      ? 'Looks like a viewing'
                      : ev.sharedByUserId
                        ? `Shared by ${memberLabel(ev.sharedByUserId, memberProfiles)}`
                        : null
                  }
                  subtitleTone={ev.state === 'suggested' ? 'warning' : undefined}
                />
              </ListItemContent>
            </ListItem>
          );
        }

        return (
          <ListItem key={item.key} onPress={() => onPressTask(item.task)}>
            <ListItemLeading>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onToggleTaskDone(item.task);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.task.done }}
                accessibilityLabel={item.task.done ? 'Mark as not done' : 'Mark as done'}
                hitSlop={14}
                className={`h-4 w-4 items-center justify-center rounded-full ${item.task.done ? 'bg-success' : 'border border-border'}`}
              >
                {item.task.done && <Check size={10} className="text-success-foreground" />}
              </Pressable>
            </ListItemLeading>
            <ListItemContent>
              <ListItemTitle className={item.task.done ? 'text-muted-foreground line-through' : undefined}>
                {item.task.title}
              </ListItemTitle>
              <AgendaMeta timeLabel={item.timeLabel} />
            </ListItemContent>
          </ListItem>
        );
      })}
    </ListGroup>
  );
}
