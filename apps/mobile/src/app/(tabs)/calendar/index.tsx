// HOUP-87: native Calendar — Day + Agenda, live data via HOUP-86's native
// StoreEnvironment + useDataCache() provider. Faithful-but-focused scope per
// the approved (and re-grounded, see the ticket's pinned comment) plan:
// the three overlap-layout algorithms live in @homeup/core (day-grid.tsx),
// all three embedded modals work (AppointmentModal/HouseholdTaskModal reused
// verbatim from HOUP-81, EventModal ported here), week-strip swipe + slot
// long-press are real gestures. The desktop 7-col hour grid stays web-only.
//
// Google Calendar sync overlay (connection status, imported events, the
// event detail sheet, dismiss/import/share) lands here via HOUP-100, once
// getSessionUser() (apps/web/src/lib/supabase/session.ts) accepted a Bearer
// fallback. EventModal's document-attachment section is deferred to HOUP-90
// (no attachment UI at all here yet — nothing to guard until that lands).
//
// HOUP-208 audit: deliberately NOT migrated to FlashList. Day view renders a
// time-grid (`DayGrid`), not a row list; Agenda view is scoped to the
// selected day only (`getAgendaItems`). Neither is an unbounded scrolling
// list — both are bounded to "one day's worth of items," so virtualization
// has nothing to save.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams } from 'expo-router';
import { Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LayoutList, ListPlus, Plus } from 'lucide-react-native';
import { Text, ActionMenu, type ActionMenuAnchor, BottomSheet, Button, HeroLede, Input, MonthDatePicker, ScreenBackground, SegmentedControl, cn, haptics, toast } from '@homeup/ui';
import {
  binCollections,
  useBins,
  agents$,
  apartments$,
  appointments$,
  CALENDAR_SPAN_OPTIONS,
  calendarAddPhrase,
  calendarSpanDays,
  calendarSpanLabel,
  calendarSpanLede,
  monthGridDays,
  shiftCalendarDate,
  type CalendarSpan,
  daysBetweenISO,
  eventTravelLegs,
  getEventsForDay,
  getWeekDays,
  groupEvents$,
  costItems$,
  hideViewingSuggestions,
  householdTasks$,
  isEventStartDay,
  isTaskOwnerEnabled,
  MOTION_DURATIONS_MS,
  useModules,
  useReconnectSync,
  useEventSave,
  useStoreHelpers,
  useStoreLoaded,
  type Agent,
  type Apartment,
  type Appointment,
  type GoogleCalendarEventWithAttribution,
  type GroupEvent,
  type HouseholdTask,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { NoGroupScreen } from '@/components/no-group-screen';
import { AppointmentModal } from '@/features/appointments/appointment-modal';
import { HouseholdTaskModal } from '@/features/tasks/household-task-modal';
import { EventModal } from '@/features/calendar/event-modal';
import { AllDayBand, DayGrid, SLOT_HEIGHT } from '@/features/calendar/day-grid';
import { AgendaList, getAgendaItems } from '@/features/calendar/agenda-list';
import { MonthView } from '@/features/calendar/month-view';
import { WeekView, WEEK_SLOT_HEIGHT } from '@/features/calendar/week-view';
import { CalendarEventSheet } from '@/features/calendar/calendar-event-sheet';
import {
  dismissCalendarEvent,
  fetchCalendarEvents,
  fetchCalendarStatus,
  importCalendarEventAsAppointment,
  importCalendarEventAsTask,
  shareCalendarEvent,
  unshareCalendarEvent,
} from '@/features/calendar/calendar-api';

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// H6: the Hero's day in words. Today / tomorrow / a weekday inside the coming
// week, then "Oct 25" (web's calendar page heroDayLabel uses the same grammar).
function heroDayLabel(day: Date): string {
  const diff = daysBetweenISO(toDateKey(new Date()), toDateKey(day));
  if (diff === 0) return 'on today';
  if (diff === 1) return 'on tomorrow';
  if (diff === -1) return 'on yesterday';
  if (diff > 1 && diff < 7) return `on ${day.toLocaleDateString('en-US', { weekday: 'long' })}`;
  return `on ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

// First hour the Day grid opens on for a day with no timed items, instead of
// midnight (web's DEFAULT_SCROLL_HOUR).
const DEFAULT_SCROLL_HOUR = 8;

export default function CalendarSectionScreen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, userSettings, groupMembers, memberProfiles, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: tasks on the calendar need calendar and household; viewings need
  // calendar and search (module-features.ts). Off, their stores aren't read
  // (an undefined group id gives the inert empty store), so nothing renders.
  const showTasks = modules.feature('calendar.tasks');
  const showViewings = modules.feature('calendar.viewings');
  // Pulled Google events need calendar and google-calendar; off, nothing is fetched.
  const showGoogleEvents = modules.feature('calendar.google-events');
  const viewingsGroupId = showViewings ? group?.id : undefined;
  // An event's ticket cost as a Budget line needs calendar and costs.
  const showBudget = modules.feature('calendar.budget');
  // Bin collection days need calendar and bins (module-features.ts).
  const showBins = modules.feature('calendar.bins');
  const binsApi = useBins(showBins ? group?.id : undefined, currentUserId);
  const openRoute = useOpenRoute();
  const openBins = React.useCallback(() => openRoute('/bins'), [openRoute]);
  const binDayOf = React.useCallback(
    (date: Date) => {
      if (!showBins || binsApi.streams.length === 0) return null;
      const key = toDateKey(date);
      return binCollections(binsApi.streams, binsApi.changes, key, key)[0] ?? null;
    },
    [showBins, binsApi.streams, binsApi.changes]
  );

  const apts$ = apartments$(viewingsGroupId);
  const agentsStore$ = agents$(viewingsGroupId);
  const appts$ = appointments$(viewingsGroupId);
  const tasks$ = householdTasks$(showTasks ? group?.id : undefined);
  const events$ = groupEvents$(group?.id);
  const costs$ = costItems$(showBudget ? group?.id : undefined);
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(appts$);
  useReconnectSync(tasks$);
  useReconnectSync(events$);
  useReconnectSync(costs$);

  const apartments = use$(() => Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted));
  const agents = use$(() => Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted));
  const appointments = use$(() => Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted));
  const allTasks = use$(() => Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted));
  // Modules: a bill or document reminder whose module is off stays off the
  // calendar, even while Tasks is on (task-modules.ts).
  const tasks = React.useMemo(
    () => allTasks.filter((t) => isTaskOwnerEnabled(t, modules.enabled)),
    [allTasks, modules.enabled]
  );
  const allGroupEvents = use$(() => Object.values(events$.get() ?? {}).filter((e): e is GroupEvent => !!e && !e.deleted));
  const groupEvents = React.useMemo(
    () => allGroupEvents.filter((e) => !e.private || e.created_by === currentUserId),
    [allGroupEvents, currentUserId]
  );
  // Travel between back-to-back events with places, on the later one's agenda row (core event-legs.ts).
  const eventLegs = React.useMemo(() => eventTravelLegs(groupEvents), [groupEvents]);

  const { writeRow: writeAppointment, softDeleteRow: deleteAppointment } = useStoreHelpers(appts$, currentUserId);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: deleteTask } = useStoreHelpers(tasks$, currentUserId);
  // Saving an event also creates, updates or removes its Budget line (event-budget.ts).
  const { linkedCostOf, saveEvent: saveEventWithCost, deleteEvent: deleteEventWithCost } = useEventSave(group?.id, currentUserId, showBudget);
  const { patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeAgent } = useStoreHelpers(agentsStore$, currentUserId);

  // The inert empty store never reports loaded, so only wait on stores in use.
  const storeLoaded = useStoreLoaded(
    events$,
    ...(showViewings ? [apts$, appts$] : []),
    ...(showTasks ? [tasks$] : [])
  );
  const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;

  const [currentDate, setCurrentDate] = React.useState(() => new Date());
  // A reminder push opens /calendar?date=YYYY-MM-DD on the event's day.
  const dateParam = useLocalSearchParams<{ date?: string }>().date;
  React.useEffect(() => {
    const m = dateParam ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam) : null;
    if (m) setCurrentDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }, [dateParam]);
  // Day, Week or Month (Week by default), each as a calendar grid or, with
  // the list toggle, as an agenda of the same span.
  const [span, setSpan] = React.useState<CalendarSpan>('week');
  const [listMode, setListMode] = React.useState(false);
  const showDayGrid = span === 'day' && !listMode;
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);

  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [chooserAt, setChooserAt] = React.useState<Date | null>(null);
  // The header "+" pops a small menu out of itself instead of the bottom sheet.
  const addButtonRef = React.useRef<View>(null);
  const [addMenuAnchor, setAddMenuAnchor] = React.useState<ActionMenuAnchor | null>(null);

  const [eventModalOpen, setEventModalOpen] = React.useState(false);
  const [editEvent, setEditEvent] = React.useState<GroupEvent | null>(null);

  const [taskModalOpen, setTaskModalOpen] = React.useState(false);
  const [editTask, setEditTask] = React.useState<HouseholdTask | null>(null);

  const [appointmentModalOpen, setAppointmentModalOpen] = React.useState(false);
  const [editAppointment, setEditAppointment] = React.useState<Appointment | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = React.useState(false);
  const [bookingApartmentId, setBookingApartmentId] = React.useState<string | null>(null);
  const [bookingAt, setBookingAt] = React.useState<Date | null>(null);
  const [apartmentPickerOpen, setApartmentPickerOpen] = React.useState(false);
  const [apartmentSearch, setApartmentSearch] = React.useState('');

  const [calendarConnected, setCalendarConnected] = React.useState(false);
  const [pulledCalendarEvents, setCalendarEvents] = React.useState<GoogleCalendarEventWithAttribution[]>([]);
  // Modules: viewing suggestions need calendar and search (module-features.ts).
  const calendarEvents = React.useMemo(
    () => hideViewingSuggestions(pulledCalendarEvents, showViewings),
    [pulledCalendarEvents, showViewings]
  );
  const [selectedCalendarEvent, setSelectedCalendarEvent] = React.useState<GoogleCalendarEventWithAttribution | null>(null);
  const [calendarActionBusy, setCalendarActionBusy] = React.useState(false);

  const weekDays = React.useMemo(() => getWeekDays(currentDate), [currentDate]);
  // The month grid shows whole weeks either side of the month, so it fetches those too.
  const overlayDays = React.useMemo(
    () => (span === 'month' ? monthGridDays(currentDate) : weekDays),
    [span, currentDate, weekDays]
  );
  const spanDays = React.useMemo(() => calendarSpanDays(span, currentDate), [span, currentDate]);

  // Google Calendar overlay (HOUP-100) — mirrors apps/web's fetchCalendarOverlay:
  // best-effort, fails silently (the overlay is supplementary, never blocking).
  const fetchCalendarOverlay = React.useCallback(async () => {
    if (!showGoogleEvents) {
      setCalendarConnected(false);
      setCalendarEvents([]);
      return;
    }
    try {
      const status = await fetchCalendarStatus();
      setCalendarConnected(status.connected);
      if (!status.connected) {
        setCalendarEvents([]);
        return;
      }
      const from = overlayDays[0];
      const to = new Date(overlayDays[overlayDays.length - 1]);
      to.setDate(to.getDate() + 1);
      setCalendarEvents(await fetchCalendarEvents(from, to));
    } catch {
      // overlay is best-effort supplementary content — fail silently
    }
  }, [overlayDays, showGoogleEvents]);

  React.useEffect(() => {
    fetchCalendarOverlay();
  }, [fetchCalendarOverlay]);

  const shiftSpan = React.useCallback(
    (step: number) => setCurrentDate((d) => shiftCalendarDate(span, d, step)),
    [span]
  );
  // Swiping the week or month grid sideways moves to the next or previous one.
  const spanPan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onEnd((e) => {
      'worklet';
      if (e.translationX > 50) runOnJS(shiftSpan)(-1);
      else if (e.translationX < -50) runOnJS(shiftSpan)(1);
    });

  const shiftWeek = React.useCallback((days: number) => {
    setCurrentDate((d) => {
      const next = new Date(d);
      next.setDate(d.getDate() + days);
      return next;
    });
  }, []);

  const weekPan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onEnd((e) => {
      'worklet';
      if (e.translationX > 50) runOnJS(shiftWeek)(-7);
      else if (e.translationX < -50) runOnJS(shiftWeek)(7);
    });

  const dayAppointments = React.useMemo(
    () => appointments.filter((a) => isSameDay(new Date(a.scheduled_at), currentDate)),
    [appointments, currentDate]
  );
  // Multi-day/spanning group events render on every day they span, not just
  // their start day (HOUP-112) — same @homeup/core helper web's calendar page
  // uses, so both platforms share one implementation.
  const dayGroupEvents = React.useMemo(
    () => getEventsForDay(groupEvents, currentDate),
    [groupEvents, currentDate]
  );

  const dayCalendarEvents = React.useMemo(
    () => (calendarConnected ? calendarEvents.filter((ev) => isSameDay(new Date(ev.starts_at), currentDate)) : []),
    [calendarConnected, calendarEvents, currentDate]
  );

  const dayHasItems = React.useCallback(
    (date: Date) => {
      if (appointments.some((a) => isSameDay(new Date(a.scheduled_at), date))) return true;
      if (calendarConnected && calendarEvents.some((ev) => isSameDay(new Date(ev.starts_at), date))) return true;
      if (getEventsForDay(groupEvents, date).length > 0) return true;
      const key = toDateKey(date);
      return tasks.some((t) => t.due_date === key);
    },
    [appointments, calendarConnected, calendarEvents, groupEvents, tasks]
  );

  const agendaItems = React.useMemo(
    () => getAgendaItems(currentDate, appointments, apartments, groupEvents, tasks, dayCalendarEvents, binDayOf(currentDate)),
    [currentDate, appointments, apartments, groupEvents, tasks, dayCalendarEvents, binDayOf]
  );

  // Day view opens scrolled to roughly the current time when viewing today,
  // instead of the top of a mostly-empty morning, or to the day's first item
  // for any other day, or to 8 AM for an empty one (mirrors apps/web's
  // columnRef scroll effect, HOUP-112).
  const dayScrollRef = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    if (!showDayGrid) return;
    const isToday = new Date().toDateString() === currentDate.toDateString();
    let offsetHours = DEFAULT_SCROLL_HOUR;
    if (isToday) {
      const now = new Date();
      offsetHours = Math.max(0, now.getHours() + now.getMinutes() / 60 - 1);
    } else {
      const starts: number[] = [];
      dayAppointments.forEach((app) => {
        const d = new Date(app.scheduled_at);
        starts.push(d.getHours() + d.getMinutes() / 60);
      });
      dayCalendarEvents
        .filter((ev) => !ev.is_all_day)
        .forEach((ev) => {
          const d = new Date(ev.starts_at);
          starts.push(d.getHours() + d.getMinutes() / 60);
        });
      dayGroupEvents
        .filter((ev) => !ev.is_all_day && isEventStartDay(ev, currentDate))
        .forEach((ev) => {
          const d = new Date(ev.starts_at);
          starts.push(d.getHours() + d.getMinutes() / 60);
        });
      if (starts.length > 0) offsetHours = Math.max(0, Math.min(...starts) - 0.5);
    }
    dayScrollRef.current?.scrollTo({ y: offsetHours * SLOT_HEIGHT, animated: false });
  }, [currentDate, dayAppointments, dayCalendarEvents, dayGroupEvents, showDayGrid]);

  // The week grid opens on the current hour this week, or 8 AM any other week.
  const weekScrollRef = React.useRef<ScrollView>(null);
  const weekKey = toDateKey(weekDays[0]);
  React.useEffect(() => {
    if (span !== 'week' || listMode) return;
    const now = new Date();
    const thisWeek = weekDays.some((d) => isSameDay(d, now));
    const hours = thisWeek ? Math.max(0, now.getHours() + now.getMinutes() / 60 - 1) : DEFAULT_SCROLL_HOUR;
    // After layout, so the ScrollView has its content height.
    requestAnimationFrame(() => weekScrollRef.current?.scrollTo({ y: hours * WEEK_SLOT_HEIGHT, animated: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span, listMode, weekKey]);

  // List mode: the span's agenda, one group per day that has anything on.
  const spanAgenda = React.useMemo(() => {
    if (!listMode) return [];
    return spanDays
      .map((day) => ({
        day,
        items: getAgendaItems(
          day,
          appointments,
          apartments,
          groupEvents,
          tasks,
          calendarConnected ? calendarEvents.filter((ev) => isSameDay(new Date(ev.starts_at), day)) : [],
          binDayOf(day)
        ),
      }))
      .filter((group) => group.items.length > 0 || span === 'day');
  }, [listMode, spanDays, appointments, apartments, groupEvents, tasks, calendarConnected, calendarEvents, span, binDayOf]);

  const taskCountFor = React.useCallback(
    (day: Date) => {
      const key = toDateKey(day);
      return tasks.filter((t) => t.due_date === key).length;
    },
    [tasks]
  );

  const apartmentById = React.useCallback((id: string) => apartments.find((a) => a.id === id) ?? null, [apartments]);
  const agentFor = React.useCallback(
    (apt: Apartment | null) => (apt?.agent_id ? agents.find((a) => a.id === apt.agent_id) ?? null : null),
    [agents]
  );

  const openAppointment = (appointment: Appointment) => {
    setEditAppointment(appointment);
    setAppointmentModalOpen(true);
  };
  const openEvent = (event: GroupEvent) => {
    setEditEvent(event);
    setEventModalOpen(true);
  };
  const openTask = (task: HouseholdTask) => {
    setEditTask(task);
    setTaskModalOpen(true);
  };
  const toggleTaskDone = (task: HouseholdTask) => {
    if (task.done) patchTask(task.id, { done: false, completed_at: null });
    else patchTask(task.id, { done: true, completed_at: new Date().toISOString() });
  };

  const handleCalendarShareToggle = async () => {
    if (!selectedCalendarEvent) return;
    setCalendarActionBusy(true);
    try {
      const toggled = selectedCalendarEvent.visibility === 'group' ? unshareCalendarEvent : shareCalendarEvent;
      const result = await toggled(selectedCalendarEvent.id);
      if (result.ok) {
        setSelectedCalendarEvent({
          ...selectedCalendarEvent,
          visibility: selectedCalendarEvent.visibility === 'group' ? 'private' : 'group',
        });
        await fetchCalendarOverlay();
      }
    } finally {
      setCalendarActionBusy(false);
    }
  };

  const handleCalendarDismiss = async () => {
    if (!selectedCalendarEvent) return;
    setCalendarActionBusy(true);
    try {
      const result = await dismissCalendarEvent(selectedCalendarEvent.id);
      if (result.ok) {
        setSelectedCalendarEvent(null);
        await fetchCalendarOverlay();
      }
    } finally {
      setCalendarActionBusy(false);
    }
  };

  const handleCalendarImportAsTask = async () => {
    if (!selectedCalendarEvent) return;
    setCalendarActionBusy(true);
    try {
      const result = await importCalendarEventAsTask(selectedCalendarEvent.id);
      if (result.ok) {
        haptics.success();
        await fetchCalendarOverlay();
        setSelectedCalendarEvent(null);
      } else {
        toast.error(result.error === 'already_imported' ? 'This event has already been imported.' : 'Could not add as to-do. Please try again.');
      }
    } finally {
      setCalendarActionBusy(false);
    }
  };

  const handleCalendarImportAsAppointment = async (apartmentId: string) => {
    if (!selectedCalendarEvent) return;
    setCalendarActionBusy(true);
    try {
      const result = await importCalendarEventAsAppointment(selectedCalendarEvent.id, apartmentId);
      if (result.ok) {
        haptics.success();
        await fetchCalendarOverlay();
        setSelectedCalendarEvent(null);
      } else {
        toast.error(
          result.error === 'already_imported' ? 'This event has already been imported.' : 'Could not import as appointment. Please try again.'
        );
      }
    } finally {
      setCalendarActionBusy(false);
    }
  };

  const openChooserAt = (at: Date) => {
    setChooserAt(at);
    // Modules: with tasks and viewings both off, "Event" is the only choice,
    // so open it directly instead of a one-item chooser.
    if (!showTasks && !showViewings) {
      setEditEvent(null);
      setEventModalOpen(true);
      return;
    }
    setChooserOpen(true);
  };

  const openAddMenu = () => {
    const at = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), new Date().getHours());
    if (!showTasks && !showViewings) {
      openChooserAt(at);
      return;
    }
    setChooserAt(at);
    addButtonRef.current?.measureInWindow((x, y, width, height) => setAddMenuAnchor({ x, y, width, height }));
  };

  const chooseNewEvent = () => {
    setAddMenuAnchor(null);
    setChooserOpen(false);
    setEditEvent(null);
    setEventModalOpen(true);
  };
  const chooseNewTodo = () => {
    setAddMenuAnchor(null);
    setChooserOpen(false);
    setEditTask(null);
    setTaskModalOpen(true);
  };
  const chooseNewAppointment = () => {
    setAddMenuAnchor(null);
    setChooserOpen(false);
    setBookingAt(chooserAt);
    setApartmentSearch('');
    setApartmentPickerOpen(true);
  };

  const filteredApartments = React.useMemo(() => {
    if (!apartmentSearch.trim()) return apartments;
    const q = apartmentSearch.toLowerCase();
    return apartments.filter((a) => a.address.toLowerCase().includes(q) || (a.suburb && a.suburb.toLowerCase().includes(q)));
  }, [apartments, apartmentSearch]);

  if (cacheLoading || (!storeLoaded && appointments.length === 0 && groupEvents.length === 0 && tasks.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const bookingApartment = bookingApartmentId ? apartmentById(bookingApartmentId) : null;
  const editingApartment = editAppointment ? apartmentById(editAppointment.apartment_id) : null;

  // Hearth v2 (Pulse): the lede counts what's on the selected day.
  // Week and Month count everything in the span instead.
  const spanCount =
    span === 'day'
      ? dayAppointments.length + dayGroupEvents.length + dayCalendarEvents.length
      : appointments.filter((a) => spanDays.some((d) => isSameDay(new Date(a.scheduled_at), d))).length +
        groupEvents.filter((ev) => spanDays.some((d) => getEventsForDay([ev], d).length > 0)).length +
        (calendarConnected ? calendarEvents.filter((ev) => spanDays.some((d) => isSameDay(new Date(ev.starts_at), d))).length : 0);
  const spanLede = span === 'day' ? heroDayLabel(currentDate) : calendarSpanLede(span, currentDate);

  return (
    <ScreenBackground style={{ paddingTop: insets.top + 16 }}>
      <View className="gap-2 px-4 pb-3">
        <HeroLede value={spanCount} label={spanLede} className="pb-1" />
        <View className="flex-row items-center justify-between">
          {/* H1: the recessed track owns this row — month + Today live together
              as one control, not competing separate elements. */}
          <View className="flex-row items-center gap-0.5 rounded-lg bg-muted/50 p-1">
            <Pressable
              onPress={() => setDatePickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose month"
              hitSlop={4}
              className="flex-row items-center gap-1 rounded-md px-2.5 py-2"
            >
              <Text className="text-sm font-semibold text-foreground">
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Pressable>
            <Pressable
              onPress={() => setCurrentDate(new Date())}
              accessibilityRole="button"
              accessibilityLabel="Jump to today"
              hitSlop={4}
              className="rounded-md px-2.5 py-2"
            >
              <Text className="text-sm font-medium text-muted-foreground">Today</Text>
            </Pressable>
          </View>
          {/* M1: the tab bar's raised "+" is the real FAB — this header action
              is demoted to ghost so it never competes with it. */}
          <View ref={addButtonRef} collapsable={false}>
            <Button variant="ghost" size="icon-sm" accessibilityLabel="Add" onPress={openAddMenu}>
              <Plus size={16} className="text-foreground" />
            </Button>
          </View>
        </View>

        {/* Span on the left, the list toggle on the right (H6: controls
            live with what they control). */}
        <View className="flex-row items-center gap-2">
          {/* The segmented control stretches to fill its row; boxed in
              flex-1 so the Agenda toggle keeps its place beside it. */}
          <View className="min-w-0 flex-1">
            <SegmentedControl
              options={CALENDAR_SPAN_OPTIONS}
              value={span}
              onChange={(next) => {
                setSpan(next);
              }}
              size="sm"
              accessibilityLabel="Day, week or month"
            />
          </View>
          <Pressable
            onPress={() => {
              haptics.select();
              setListMode((v) => !v);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: listMode }}
            accessibilityLabel="Agenda"
            hitSlop={6}
            className={cn(
              'min-h-9 flex-row items-center gap-1.5 rounded-full border px-3',
              listMode ? 'border-primary/40 bg-primary/15' : 'border-border'
            )}
          >
            <LayoutList size={14} className={listMode ? 'text-primary' : 'text-muted-foreground'} />
            <Text className={cn('text-xs font-medium', listMode ? 'text-primary' : 'text-muted-foreground')}>Agenda</Text>
          </Pressable>
        </View>

        {span === 'day' ? (
          <View className="flex-row items-center gap-1">
          <Pressable
              onPress={() => shiftWeek(-7)}
              accessibilityRole="button"
              accessibilityLabel="Previous week"
              hitSlop={8}
              className="shrink-0 rounded-lg p-1.5"
            >
              <ChevronLeft size={16} className="text-muted-foreground" />
            </Pressable>
            <GestureDetector gesture={weekPan}>
              <View className="flex-1 flex-row gap-1">
                {weekDays.map((d) => {
                  const selected = isSameDay(d, currentDate);
                  const isToday = isSameDay(d, new Date());
                  // H2: the selected day is the control's state (a soft teal
                  // tint); today is told by a neutral ring, and a day's dot is a
                  // neutral count marker, teal only on the selected day (web's
                  // week strip draws the same).
                  return (
                    <Pressable
                      key={toDateKey(d)}
                      onPress={() => {
                        if (!selected) haptics.select();
                        setCurrentDate(d);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`}
                      className={cn(
                        'min-h-11 flex-1 items-center justify-center gap-0.5 rounded-xl py-1.5',
                        selected ? 'bg-primary/15' : isToday && 'border border-border'
                      )}
                    >
                      <Text className={cn('text-[10px] font-medium', selected ? 'text-primary' : 'text-muted-foreground')}>
                        {WEEKDAY_LABELS[d.getDay()]}
                      </Text>
                      <Text
                        className={cn('text-sm font-semibold', selected ? 'text-primary' : 'text-foreground')}
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {d.getDate()}
                      </Text>
                      <View
                        className={cn(
                          'h-1 w-1 rounded-full',
                          dayHasItems(d) ? (selected ? 'bg-primary' : 'bg-muted-foreground/70') : 'bg-transparent'
                        )}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </GestureDetector>
            <Pressable
              onPress={() => shiftWeek(7)}
              accessibilityRole="button"
              accessibilityLabel="Next week"
              hitSlop={8}
              className="shrink-0 rounded-lg p-1.5"
            >
              <ChevronRight size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => shiftSpan(-1)}
              accessibilityRole="button"
              accessibilityLabel={span === 'week' ? 'Previous week' : 'Previous month'}
              hitSlop={8}
              className="rounded-lg p-1.5"
            >
              <ChevronLeft size={16} className="text-muted-foreground" />
            </Pressable>
            <Text className="text-sm font-semibold text-foreground">{calendarSpanLabel(span, currentDate)}</Text>
            <Pressable
              onPress={() => shiftSpan(1)}
              accessibilityRole="button"
              accessibilityLabel={span === 'week' ? 'Next week' : 'Next month'}
              hitSlop={8}
              className="rounded-lg p-1.5"
            >
              <ChevronRight size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
        )}
      </View>

      {listMode ? (
        <GestureDetector gesture={spanPan}>
          <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
            {spanAgenda.length === 0 ? (
              <Text className="py-12 text-center text-body text-muted-foreground">
                Nothing on {span === 'week' ? 'this week' : 'this month'}.
              </Text>
            ) : (
              spanAgenda.map(({ day, items }) => (
                <View key={toDateKey(day)} className="gap-1.5">
                  {span !== 'day' && (
                    <Text className="px-1 text-micro-label uppercase text-muted-foreground">
                      {isSameDay(day, new Date()) ? 'Today' : calendarSpanLabel('day', day)}
                    </Text>
                  )}
                  <AgendaList
              legs={eventLegs}
                    items={items}
                    memberProfiles={memberProfiles}
                    onPressAppointment={openAppointment}
                    onPressEvent={openEvent}
                    onPressCalendarEvent={setSelectedCalendarEvent}
                    onPressTask={openTask}
              onPressBins={openBins}
                    onToggleTaskDone={toggleTaskDone}
                    addPhrase={calendarAddPhrase({ tasks: showTasks, viewings: showViewings })}
                    onAddSomething={() =>
                      openChooserAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), new Date().getHours()))
                    }
                  />
                </View>
              ))
            )}
          </ScrollView>
        </GestureDetector>
      ) : span === 'week' ? (
        <GestureDetector gesture={spanPan}>
          <View className="flex-1">
            <WeekView
              days={weekDays}
              selectedDay={currentDate}
              appointments={appointments}
              apartments={apartments}
              durationMinutes={durationMinutes}
              groupEvents={groupEvents}
              calendarEvents={calendarConnected ? calendarEvents : []}
              scrollRef={weekScrollRef}
              onPressDay={(d) => {
                setCurrentDate(d);
                setSpan('day');
              }}
              onPressAppointment={openAppointment}
              onPressEvent={openEvent}
              onPressCalendarEvent={setSelectedCalendarEvent}
              onLongPressSlot={openChooserAt}
            />
          </View>
        </GestureDetector>
      ) : span === 'month' ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          <GestureDetector gesture={spanPan}>
            <View>
              <MonthView
                month={currentDate}
                selectedDay={currentDate}
                appointments={appointments}
                groupEvents={groupEvents}
                calendarEvents={calendarConnected ? calendarEvents : []}
                taskCountFor={taskCountFor}
                onPressDay={setCurrentDate}
              />
            </View>
          </GestureDetector>
          {/* The picked day's agenda, under the grid. */}
          <View className="gap-1.5 px-4 pt-4">
            <Text className="px-1 text-micro-label uppercase text-muted-foreground">
              {isSameDay(currentDate, new Date()) ? 'Today' : calendarSpanLabel('day', currentDate)}
            </Text>
            <AgendaList
                    legs={eventLegs}
              items={agendaItems}
              memberProfiles={memberProfiles}
              onPressAppointment={openAppointment}
              onPressEvent={openEvent}
              onPressCalendarEvent={setSelectedCalendarEvent}
              onPressTask={openTask}
              onPressBins={openBins}
              onToggleTaskDone={toggleTaskDone}
              addPhrase={calendarAddPhrase({ tasks: showTasks, viewings: showViewings })}
              onAddSomething={() => openChooserAt(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), new Date().getHours()))}
            />
          </View>
        </ScrollView>
      ) : (
        <>
          <AllDayBand
            day={currentDate}
            groupEvents={dayGroupEvents}
            calendarEvents={dayCalendarEvents}
            onPressEvent={openEvent}
            onPressCalendarEvent={setSelectedCalendarEvent}
          />
          {/* Above the scroll, not inside it: an empty day opens on 8 AM, which
              would scroll a hint at the grid's top out of view. */}
          {dayAppointments.length === 0 && dayGroupEvents.length === 0 && dayCalendarEvents.length === 0 && (
            <Text className="px-4 pb-2 pt-1 text-xs text-muted-foreground">Nothing scheduled. Hold a slot to add.</Text>
          )}
          <ScrollView ref={dayScrollRef} className="flex-1" contentContainerStyle={{ paddingBottom: 16 }}>
            <DayGrid
              day={currentDate}
              appointments={dayAppointments}
              apartments={apartments}
              durationMinutes={durationMinutes}
              groupEvents={dayGroupEvents}
              calendarEvents={dayCalendarEvents}
              onPressAppointment={openAppointment}
              onPressEvent={openEvent}
              onPressCalendarEvent={setSelectedCalendarEvent}
              onLongPressSlot={openChooserAt}
            />
          </ScrollView>
        </>
      )}

      <MonthDatePicker
        open={datePickerOpen}
        initialDate={currentDate}
        hasItems={dayHasItems}
        onClose={() => setDatePickerOpen(false)}
        onSelect={(d) => {
          setCurrentDate(d);
          setDatePickerOpen(false);
        }}
        onToday={() => {
          setCurrentDate(new Date());
          setDatePickerOpen(false);
        }}
      />

      <ActionMenu
        anchor={addMenuAnchor}
        onClose={() => setAddMenuAnchor(null)}
        items={[
          { key: 'event', label: 'Event', Icon: CalendarDays, onPress: chooseNewEvent },
          // Modules: calendar.viewings / calendar.tasks (module-features.ts).
          ...(showViewings ? [{ key: 'viewing', label: 'Apartment viewing', Icon: Building2, onPress: chooseNewAppointment }] : []),
          ...(showTasks ? [{ key: 'todo', label: 'To-do', Icon: ListPlus, onPress: chooseNewTodo }] : []),
        ]}
      />

      <BottomSheet open={chooserOpen} onOpenChange={setChooserOpen}>
        <View className="gap-2 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">New…</Text>
          <Button variant="outline" onPress={chooseNewEvent}>
            Event
          </Button>
          {/* Modules: calendar.viewings / calendar.tasks (module-features.ts). */}
          {showViewings && (
            <Button variant="outline" onPress={chooseNewAppointment}>
              Apartment viewing
            </Button>
          )}
          {showTasks && (
            <Button variant="outline" onPress={chooseNewTodo}>
              To-do
            </Button>
          )}
        </View>
      </BottomSheet>

      {/* HOUP-191: these four modals always render — only `open` toggles — so
          the sheet's 250ms exit animation gets to play. Wrapping in `{x &&
          (...)}` used to unmount the whole component the instant the boolean
          flipped false, killing the animation; every close path below now
          flips `open` first and defers clearing the edited item (plus its
          store write) until after MOTION_DURATIONS_MS.exit, mirroring
          apps/mobile/src/app/(tabs)/tasks/index.tsx's HouseholdTaskModal usage. */}
      <EventModal
        key={editEvent?.id ?? 'new-event'}
        open={eventModalOpen}
        event={editEvent ?? undefined}
        groupId={group.id}
        defaultDate={chooserAt ? toDateKey(chooserAt) : undefined}
        defaultTime={chooserAt ? `${String(chooserAt.getHours()).padStart(2, '0')}:${String(chooserAt.getMinutes()).padStart(2, '0')}` : undefined}
        onClose={() => { setEventModalOpen(false); setTimeout(() => setEditEvent(null), MOTION_DURATIONS_MS.exit); }}
        showBudget={showBudget}
        costCents={linkedCostOf(editEvent)?.amount ?? null}
        onSave={(saved, costCents) => {
          setEventModalOpen(false);
          setTimeout(() => { saveEventWithCost(saved, costCents); setEditEvent(null); }, MOTION_DURATIONS_MS.exit);
        }}
        onDelete={(id) => {
          setEventModalOpen(false);
          // The event's Budget line goes with it.
          const target = editEvent;
          setTimeout(() => { if (target?.id === id) deleteEventWithCost(target); setEditEvent(null); }, MOTION_DURATIONS_MS.exit);
        }}
      />

      {/* Modules: adding a to-do from the calendar needs calendar and household (module-features.ts). */}
      {showTasks && (
        <HouseholdTaskModal
          key={editTask?.id ?? 'new-task'}
          open={taskModalOpen}
          task={editTask ?? undefined}
          groupId={group.id}
          currentUserId={currentUserId}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          initialDueDate={chooserAt ? toDateKey(chooserAt) : undefined}
          initialDueTime={chooserAt ? `${String(chooserAt.getHours()).padStart(2, '0')}:${String(chooserAt.getMinutes()).padStart(2, '0')}` : undefined}
          onClose={() => { setTaskModalOpen(false); setTimeout(() => setEditTask(null), MOTION_DURATIONS_MS.exit); }}
          onSave={(saved) => {
            setTaskModalOpen(false);
            setTimeout(() => { writeTask(saved); setEditTask(null); }, MOTION_DURATIONS_MS.exit);
          }}
          onDelete={(id) => {
            setTaskModalOpen(false);
            setTimeout(() => { deleteTask(id); setEditTask(null); }, MOTION_DURATIONS_MS.exit);
          }}
        />
      )}

      {/* Modules: viewings and booking one need calendar and search (module-features.ts). */}
      {showViewings && (
        <>
          <AppointmentModal
            key={editAppointment?.id ?? 'edit-appointment'}
            open={appointmentModalOpen}
            appointment={editAppointment ?? undefined}
            apartmentId={editAppointment?.apartment_id ?? ''}
            apartment={editingApartment}
            agent={agentFor(editingApartment)}
            groupId={group.id}
            currentUserId={currentUserId}
            defaultDurationMinutes={durationMinutes}
            onClose={() => { setAppointmentModalOpen(false); setTimeout(() => setEditAppointment(null), MOTION_DURATIONS_MS.exit); }}
            onSave={(saved) => {
              setAppointmentModalOpen(false);
              setTimeout(() => { writeAppointment(saved); setEditAppointment(null); }, MOTION_DURATIONS_MS.exit);
            }}
            onDelete={(id) => {
              setAppointmentModalOpen(false);
              setTimeout(() => { deleteAppointment(id); setEditAppointment(null); }, MOTION_DURATIONS_MS.exit);
            }}
          />

          <AppointmentModal
            key={bookingApartmentId ? `new-${bookingApartmentId}` : 'new-booking'}
            open={bookingModalOpen}
            apartmentId={bookingApartmentId ?? ''}
            apartment={bookingApartment}
            agent={agentFor(bookingApartment)}
            agents={agents}
            groupId={group.id}
            currentUserId={currentUserId}
            defaultDurationMinutes={durationMinutes}
            initialScheduledAt={bookingAt ?? undefined}
            onClose={() => { setBookingModalOpen(false); setTimeout(() => setBookingApartmentId(null), MOTION_DURATIONS_MS.exit); }}
            onSave={(created) => {
              setBookingModalOpen(false);
              setTimeout(() => { writeAppointment(created); setBookingApartmentId(null); }, MOTION_DURATIONS_MS.exit);
            }}
            onSaveAgent={writeAgent}
            onAssignApartmentAgent={(apartmentId, agentId) => patchApartment(apartmentId, { agent_id: agentId })}
          />

          <BottomSheet open={apartmentPickerOpen} onOpenChange={setApartmentPickerOpen}>
            <View className="gap-3 px-4 pb-2 pt-1">
              <Text className="font-heading text-title font-medium text-foreground">Select apartment</Text>
              <Input value={apartmentSearch} onChangeText={setApartmentSearch} placeholder="Search by address…" autoFocus />
              <ScrollView className="max-h-72">
                <View className="gap-1">
                  {filteredApartments.slice(0, 20).map((apt) => (
                    <Pressable
                      key={apt.id}
                      onPress={() => { setBookingApartmentId(apt.id); setBookingModalOpen(true); setApartmentPickerOpen(false); setApartmentSearch(''); }}
                      className="rounded-md px-3 py-2 active:bg-muted"
                    >
                      <Text className="text-sm font-medium text-foreground">
                        {apt.address}
                        {apt.suburb ? <Text className="text-muted-foreground"> ({apt.suburb})</Text> : null}
                      </Text>
                    </Pressable>
                  ))}
                  {filteredApartments.length === 0 && (
                    <Text className="px-3 py-2 text-sm text-muted-foreground">No apartments match.</Text>
                  )}
                </View>
              </ScrollView>
            </View>
          </BottomSheet>
        </>
      )}

      <CalendarEventSheet
        event={selectedCalendarEvent}
        onClose={() => setSelectedCalendarEvent(null)}
        memberProfiles={memberProfiles}
        apartments={apartments}
        busy={calendarActionBusy}
        onShareToggle={handleCalendarShareToggle}
        onDismiss={handleCalendarDismiss}
        // Modules: import as a to-do or a viewing only when the calendar shows them (module-features.ts).
        onImportAsTask={showTasks ? handleCalendarImportAsTask : undefined}
        onImportAsAppointment={showViewings ? handleCalendarImportAsAppointment : undefined}
      />
    </ScreenBackground>
  );
}
