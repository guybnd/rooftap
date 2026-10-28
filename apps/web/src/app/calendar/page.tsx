"use client";

import { HeroLede } from '@/components/ui/hero-lede';
import { ModuleSettingsButton } from '@/components/module-settings-sheet';
import { LeadingTile } from '@/components/ui/leading-tile';
import { sectionIconFor } from '@/lib/section-icons';
import { cn } from '@/lib/utils';
import { useState, useRef, useCallback, useMemo, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  MapPin,
  Search,
  X,
  Clock,
  ExternalLink,
  Share2,
  ListPlus,
  Building2,
  Navigation,
  EyeOff,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { commit } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AppointmentModal } from "@/components/appointment-modal";
import { ScrollField } from "@/components/scroll-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { memberLabel } from "@/app/setup/member-label";
import { useLongPress } from "@/hooks/use-long-press";
import { HouseholdTaskModal } from "@/app/tasks/household-task-modal";
import { EventModal } from "@/app/calendar/event-modal";
import { ModuleRowTrailing } from "@/components/module-row-parts";
import { useRowContextMenu } from "@/components/ui/row-context-menu";
import {
  eventCategoryClasses,
  calendarEntriesOn,
  calendarRangeOf,
  useCalendarEntries,
  householdTasks$,
  groupEvents$,
  costItems$,
  useEventSave,
  eventTravelLegs,
  legText,
  type EventLeg,
  apartments$,
  agents$,
  appointments$,
  useStoreHelpers,
  useReconnectSync,
  computeOverlapLayout,
  computeEventOverlapLayout,
  computeCalendarOverlapLayout,
  getEventsForDay as getEventsForDayCore,
  isEventStartDay,
  pickAgentColor,
  compareStrings,
  isTaskOwnerEnabled,
  useModules,
  calendarAddPhrase,
  calendarAgenda,
  calendarDayCount,
  calendarDayHasItems,
  calendarOpenHour,
  filterApartments,
  formatClockTime,
  formatHourLabel,
  heroDayLabel,
  isSameLocalDay,
  toISODate,
  useCalendarOverlay,
  eventDetailLabel,
  mapsDirectionsUrl,
  dialog,
  type RowMenu,
} from '@homeup/core';
import { MonthDatePicker } from "@/components/month-date-picker";
import type { Agent, Apartment, Appointment, CalendarAgendaItem, CalendarEntry, GoogleCalendarEventWithAttribution, GroupEvent, HouseholdTask } from '@homeup/core';
import { useEventForecast } from "@/lib/use-event-forecast";
import { useLegTravel } from "@/lib/use-event-travel";
import { calendarApi } from "@/lib/calendar-client";

// Full 24h grid — was 7am-9pm, which silently dropped events starting outside
// that window from the Day/Week grid entirely (FLUX-1562).
const START_HOUR = 0;
const END_HOUR = 24;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const DESKTOP_SLOT_HEIGHT = 80;
// Fits ~10-11h of a mobile viewport at once (was 90 — only ~6-7h visible; FLUX-257).
const MOBILE_SLOT_HEIGHT = 56;
const SLOTS_PER_HOUR = 4; // 15-min increments
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// The week range for the desktop header: "Oct 18 – 24", or "Oct 28 – Nov 3"
// across a month boundary.
function formatWeekRange(start: Date, end: Date) {
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel =
    start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

// A timed block shorter than this shows its time and title on one line, so a
// 20-minute viewing never clips to just "4:00 PM".
const COMPACT_BLOCK_PX = 40;
// Tall enough for a third line: an event's place under its title.
const DETAIL_BLOCK_PX = 52;

export default function CalendarPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-muted-foreground">Loading…</div>}>
      <CalendarPage />
    </Suspense>
  );
}

function CalendarPage() {
  const { group, loading, userSettings, memberProfiles, currentUserId } = useDataCache();
  const modules = useModules();
  // Modules: tasks on the calendar need calendar and household; viewings need
  // calendar and search (module-features.ts). Off, their stores aren't read
  // (an undefined group id gives the inert empty store), so nothing renders.
  const showTasks = modules.feature("calendar.tasks");
  const showViewings = modules.feature("calendar.viewings");
  // Pulled Google events need calendar and google-calendar; off, nothing is fetched.
  const showGoogleEvents = modules.feature("calendar.google-events");
  const viewingsGroupId = showViewings ? group?.id : undefined;

  const apts$ = apartments$(viewingsGroupId);
  const agentsStore$ = agents$(viewingsGroupId);
  const appts$ = appointments$(viewingsGroupId);
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(appts$);

  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const appointments = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const { patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeAgent, patchRow: patchAgent } = useStoreHelpers(agentsStore$, currentUserId);
  const { writeRow: writeAppointment } = useStoreHelpers(appts$, currentUserId);

  const tasks$ = householdTasks$(showTasks ? group?.id : undefined);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: deleteTask } = useStoreHelpers(tasks$, currentUserId);
  const allTasks = use$(() =>
    Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted)
  );
  // Modules: a bill or document reminder whose module is off stays off the
  // calendar, even while Tasks is on (task-modules.ts).
  const tasks = useMemo(() => allTasks.filter((t) => isTaskOwnerEnabled(t, modules.enabled)), [allTasks, modules.enabled]);
  const events$ = groupEvents$(group?.id);
  useReconnectSync(events$);
  // An event's ticket cost as a Budget line needs calendar and costs.
  const showBudget = modules.feature("calendar.budget");
  const costs$ = costItems$(showBudget ? group?.id : undefined);
  // Saving an event also creates, updates or removes its Budget line (event-budget.ts).
  const { linkedCostOf, saveEvent: saveEventWithCost, deleteEvent: deleteEventWithCost } = useEventSave(group?.id, currentUserId, showBudget);
  const allGroupEvents = use$(() =>
    Object.values(events$.get() ?? {}).filter((e): e is GroupEvent => !!e && !e.deleted)
  );
  const groupEvents = useMemo(
    () => allGroupEvents.filter((e) => !e.private || e.created_by === currentUserId),
    [allGroupEvents, currentUserId]
  );
  // Travel between back-to-back events with places, on the later one's agenda line (core event-legs.ts).
  const eventLegs = useMemo(() => eventTravelLegs(groupEvents), [groupEvents]);
  const legOf = (eventId: string) => eventLegs.find((l) => l.toId === eventId);
  const searchParams = useSearchParams();
  const [currentDate, setCurrentDate] = useState(() => {
    const d = searchParams.get("date");
    if (d) {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(y, m - 1, day);
    }
    return new Date();
  });
  const [mobileDayOffset, setMobileDayOffset] = useState(() => {
    const d = searchParams.get("date");
    if (d) {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(y, m - 1, day).getDay();
    }
    return new Date().getDay();
  });
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserAnchor, setChooserAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [chooserSlot, setChooserSlot] = useState<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  } | null>(null);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [editTask, setEditTask] = useState<HouseholdTask | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<GroupEvent | null>(null);
  const [mobileView, setMobileView] = useState<"day" | "agenda">("day");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingYear, setBookingYear] = useState(new Date().getFullYear());
  const [bookingMonth, setBookingMonth] = useState(new Date().getMonth());
  const [bookingDay, setBookingDay] = useState(new Date().getDate());
  const [bookingHour, setBookingHour] = useState(9);
  const [bookingMinute, setBookingMinute] = useState(0);
  const [bookingDuration, setBookingDuration] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedApartmentId, setSelectedApartmentId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [editAppointment, setEditAppointment] = useState<Appointment | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [calendarDetailOpen, setCalendarDetailOpen] = useState(false);
  const [importApartmentPickerOpen, setImportApartmentPickerOpen] = useState(false);
  const [importSearchQuery, setImportSearchQuery] = useState("");
  const router = useRouter();
  const cardTouchRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; moved: boolean } | null>(null);

  const startOfWeek = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(currentDate.getDate() - currentDate.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        return d;
      }),
    [startOfWeek]
  );

  const mobileDay = useMemo(() => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + mobileDayOffset);
    return d;
  }, [startOfWeek, mobileDayOffset]);

  // Google Calendar overlay: core's useCalendarOverlay, shared with native.
  // Best-effort: a failed call keeps what's shown, never blocks.
  const overlayTo = useMemo(() => {
    const to = new Date(startOfWeek);
    to.setDate(to.getDate() + 7);
    return to;
  }, [startOfWeek]);
  const overlay = useCalendarOverlay({
    api: calendarApi,
    enabled: showGoogleEvents,
    showViewings,
    from: startOfWeek,
    to: overlayTo,
    notifyError: (message) => toast.error(message),
    onClosed: () => {
      setCalendarDetailOpen(false);
      setImportApartmentPickerOpen(false);
    },
  });
  // Other modules' entries (bin night, occasions): the calendar slot, each gated on its own feature.
  const slotRange = useMemo(() => calendarRangeOf(days), [days]);
  const slotEntries = useCalendarEntries(group?.id, currentUserId, slotRange);
  const {
    connected: calendarConnected,
    events: calendarEvents,
    selected: selectedCalendarEvent,
    setSelected: setSelectedCalendarEvent,
    busy: calendarActionBusy,
  } = overlay;

  useEffect(() => {
    const dateStr = toISODate(mobileDay);
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") !== dateStr) {
      url.searchParams.set("date", dateStr);
      window.history.replaceState({}, "", url.toString());
    }
  }, [mobileDay]);

  // Open the mobile day view scrolled to roughly the current time when viewing
  // today, instead of the top of a mostly-empty morning (FLUX-233 #3). For any
  // other day, scroll to its first item instead of a mostly-empty morning (FLUX-257).
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const openHour = calendarOpenHour([mobileDay], {
      appointments,
      groupEvents,
      calendarEvents: calendarConnected ? calendarEvents : [],
    });
    el.scrollTop = (openHour - START_HOUR) * MOBILE_SLOT_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileDay, appointments, calendarEvents, calendarConnected, groupEvents]);

  // The desktop week grid opens the same way as the phone day view: on the
  // current time when the week holds today, else an hour before the week's
  // first timed item, else the morning. It re-scrolls only when that target
  // moves (a new week, or the week's items arriving), never on every sync, so
  // it doesn't yank a grid the person has scrolled themselves.
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const desktopScrollKeyRef = useRef("");
  useEffect(() => {
    const el = desktopScrollRef.current;
    if (!el) return;
    const now = new Date();
    const weekHasToday = days.some((d) => isSameLocalDay(d, now));
    const targetHour = calendarOpenHour(days, { appointments, groupEvents, calendarEvents: calendarConnected ? calendarEvents : [] }, now);
    const key = `${toISODate(days[0])}@${weekHasToday ? "now" : targetHour}`;
    if (desktopScrollKeyRef.current === key) return;
    desktopScrollKeyRef.current = key;
    el.scrollTop = (targetHour - START_HOUR) * DESKTOP_SLOT_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, appointments, calendarEvents, calendarConnected, groupEvents]);

  const prevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(currentDate.getDate() - 7);
    setCurrentDate(d);
  };

  const nextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(currentDate.getDate() + 7);
    setCurrentDate(d);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setMobileDayOffset(new Date().getDay());
  };

  // Swipeable week strip (FLUX-257) — same touch-delta pattern as photo-gallery.tsx's
  // Lightbox: a horizontal drag past the threshold pages the week, keeping the
  // selected weekday (mobileDayOffset is untouched; mobileDay re-derives from the
  // new startOfWeek). Lives on the strip only, never the grid body (Risks note).
  const weekStripTouchStart = useRef<{ x: number; y: number } | null>(null);
  const handleWeekStripTouchStart = (e: React.TouchEvent) => {
    weekStripTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleWeekStripTouchEnd = (e: React.TouchEvent) => {
    const start = weekStripTouchStart.current;
    weekStripTouchStart.current = null;
    if (!start) return;
    const deltaX = e.changedTouches[0].clientX - start.x;
    const deltaY = e.changedTouches[0].clientY - start.y;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (deltaX > 0) prevWeek();
    else nextWeek();
  };

  const getSlotFromY = useCallback((y: number, slotHeight: number) => {
    return Math.max(0, Math.min(HOURS.length * SLOTS_PER_HOUR - 1, Math.floor(y / (slotHeight / SLOTS_PER_HOUR))));
  }, []);

  const triggerHaptic = useCallback(() => {
    commit();
  }, []);

  const openBookingDialogAt = useCallback(
    (year: number, month: number, day: number, hour: number, minute: number) => {
      setBookingYear(year);
      setBookingMonth(month);
      setBookingDay(day);
      setBookingHour(hour);
      setBookingMinute(minute);
      setBookingDuration(userSettings?.appointment_duration_minutes ?? 20);
      setSearchQuery("");
      setSelectedApartmentId(null);
      setNotes("");
      setAgentName("");
      setAgentPhone("");
      setBookingOpen(true);
    },
    [userSettings]
  );

  // Background long-press → "New appointment" / "New to-do" chooser (FLUX-233 #2).
  // Dragging the grid never creates anything anymore — it's native overflow-y-auto
  // panning. `pendingPressRef` carries which slot was pressed from onPointerDown
  // through to the long-press callback below (the shared useLongPress hook has no
  // per-press payload, so the ref is how position survives to the fire callback).
  const pendingPressRef = useRef<{
    dayIndex: number;
    isMobile: boolean;
    clientX: number;
    clientY: number;
    rectTop: number;
  } | null>(null);

  const handleSlotLongPress = useCallback(() => {
    const pending = pendingPressRef.current;
    if (!pending) return;
    const slotHeight = pending.isMobile ? MOBILE_SLOT_HEIGHT : DESKTOP_SLOT_HEIGHT;
    const slot = getSlotFromY(pending.clientY - pending.rectTop, slotHeight);
    const hour = START_HOUR + slot / SLOTS_PER_HOUR;
    const d = pending.isMobile ? mobileDay : days[pending.dayIndex];

    triggerHaptic();
    const CHOOSER_W = 176;
    const CHOOSER_H = 96;
    setChooserAnchor({
      x: Math.min(Math.max(pending.clientX, CHOOSER_W / 2 + 8), window.innerWidth - CHOOSER_W / 2 - 8),
      y: Math.min(Math.max(pending.clientY, 8), window.innerHeight - CHOOSER_H - 8),
    });
    setChooserSlot({
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      hour: Math.floor(hour),
      minute: Math.round((hour % 1) * 60),
    });
    // Modules: with tasks and viewings both off, "New event" is the only
    // choice, so open it directly instead of a one-item chooser.
    if (!showTasks && !showViewings) {
      setEditEvent(null);
      setEventModalOpen(true);
      return;
    }
    setChooserOpen(true);
  }, [days, mobileDay, getSlotFromY, triggerHaptic, showTasks, showViewings]);

  const { handlers: longPressHandlers } = useLongPress(handleSlotLongPress);

  const handleSlotPointerDown = useCallback(
    (dayIndex: number, isMobile: boolean, e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      pendingPressRef.current = {
        dayIndex,
        isMobile,
        clientX: e.clientX,
        clientY: e.clientY,
        rectTop: rect.top,
      };
      longPressHandlers.onPointerDown(e);
    },
    [longPressHandlers]
  );

  // Hearth §13.7: with a mouse, a double-click or right-click on an empty
  // slot opens the same chooser a long-press does. Blocks on the slot keep
  // their own clicks, so only the bare grid (or its hour lines) counts.
  const handleSlotMouseAdd = useCallback(
    (dayIndex: number, isMobile: boolean, e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target !== e.currentTarget && (target.parentElement !== e.currentTarget || target.hasChildNodes())) return;
      e.preventDefault();
      pendingPressRef.current = {
        dayIndex,
        isMobile,
        clientX: e.clientX,
        clientY: e.clientY,
        rectTop: e.currentTarget.getBoundingClientRect().top,
      };
      handleSlotLongPress();
    },
    [handleSlotLongPress]
  );

  const chooseNewEvent = () => {
    setChooserOpen(false);
    setEditEvent(null);
    setEventModalOpen(true);
  };

  const chooseNewAppointment = () => {
    if (!chooserSlot) return;
    openBookingDialogAt(chooserSlot.year, chooserSlot.month, chooserSlot.day, chooserSlot.hour, chooserSlot.minute);
    setChooserOpen(false);
  };

  const chooseNewTodo = () => {
    setChooserOpen(false);
    setTodoModalOpen(true);
  };

  const columnRef = useRef<HTMLDivElement>(null);

  // Opens the same "New event" default / "Apartment viewing" / "New to-do"
  // chooser as a background long-press, centered in the thumb zone above the
  // nav bar. Originally the mobile FAB's handler (FLUX-249); the FAB is gone
  // (FLUX-257 — redundant with the global capture "+") so this now fires from
  // the ?compose=event arrival effect below, reached via the capture launcher's
  // "Calendar event" tile.
  const openComposeChooser = () => {
    const now = new Date();
    const CHOOSER_H = 96;
    setChooserAnchor({
      x: window.innerWidth / 2,
      y: window.innerHeight - CHOOSER_H - 88,
    });
    setChooserSlot({
      year: mobileDay.getFullYear(),
      month: mobileDay.getMonth(),
      day: mobileDay.getDate(),
      hour: now.getHours(),
      minute: Math.round(now.getMinutes() / 15) * 15,
    });
    // Modules: same one-choice shortcut as the long-press above.
    if (!showTasks && !showViewings) {
      setEditEvent(null);
      setEventModalOpen(true);
      return;
    }
    setChooserOpen(true);
  };

  // Capture launcher's "Calendar event" tile navigates to ?compose=event; open
  // the same chooser the removed FAB used to. Depends on `searchParams` (not a
  // mount-only []) so it also fires when the launcher is tapped while already
  // on /calendar — that's a same-route query-only navigation, no remount. The
  // manual history.replaceState (not router.replace) clears the URL without
  // updating the searchParams the hook returns, so this doesn't loop; a later
  // arrival with the same param produces a new searchParams value and refires.
  useEffect(() => {
    if (searchParams.get("compose") !== "event") return;
    openComposeChooser();
    const url = new URL(window.location.href);
    url.searchParams.delete("compose");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

const filteredApartments = useMemo(() => filterApartments(apartments, searchQuery), [apartments, searchQuery]);

  const selectedApartment = apartments.find((a) => a.id === selectedApartmentId);
  const selectedAgent = selectedApartment?.agent_id
    ? agents.find((a) => a.id === selectedApartment.agent_id)
    : null;

  const handleSelectApartment = (aptId: string) => {
    setSelectedApartmentId(aptId);
    const apt = apartments.find((a) => a.id === aptId);
    const aptAgent = apt?.agent_id ? agents.find((a) => a.id === apt.agent_id) : null;
    if (aptAgent) {
      setAgentName(aptAgent.name);
      setAgentPhone(aptAgent.phone || "");
    } else {
      setAgentName("");
      setAgentPhone("");
    }
  };

  const handleSaveBooking = async () => {
    if (!selectedApartmentId || !group?.id || !currentUserId) return;
    setSaving(true);

    // If user entered agent details and apartment has no agent, create/assign
    if (agentName.trim() && !selectedAgent) {
      const existingAgent = agents.find(
        (a) => a.name.toLowerCase() === agentName.trim().toLowerCase()
      );
      let assignAgentId: string;

      if (existingAgent) {
        assignAgentId = existingAgent.id;
        if (agentPhone.trim() && agentPhone.trim() !== existingAgent.phone) {
          patchAgent(existingAgent.id, { phone: agentPhone.trim() });
        }
      } else {
        const color = pickAgentColor(agents);
        const newAgentId = crypto.randomUUID();
        writeAgent({
          id: newAgentId,
          user_id: currentUserId,
          group_id: group.id,
          name: agentName.trim(),
          phone: agentPhone.trim() || null,
          color,
          notes: null,
          deleted: false,
          created_at: null as unknown as string,
          updated_at: null as unknown as string,
        });
        assignAgentId = newAgentId;
      }

      patchApartment(selectedApartmentId, { agent_id: assignAgentId });
    }

    const scheduledAt = new Date(bookingYear, bookingMonth, bookingDay, bookingHour, bookingMinute, 0, 0);

    writeAppointment({
      id: crypto.randomUUID(),
      user_id: currentUserId,
      group_id: group.id,
      apartment_id: selectedApartmentId,
      scheduled_at: scheduledAt.toISOString(),
      notes: notes || null,
      status: "scheduled",
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });

    setBookingOpen(false);
    setSaving(false);
  };

  const getAppointmentsForDay = (date: Date) => appointments.filter((app) => isSameLocalDay(new Date(app.scheduled_at), date));

  const getCalendarEventsForDay = (date: Date) => calendarEvents.filter((ev) => isSameLocalDay(new Date(ev.starts_at), date));

  const isAllDayCalendarEvent = (ev: GoogleCalendarEventWithAttribution) => ev.is_all_day;

  const getCalendarEventClasses = (ev: GoogleCalendarEventWithAttribution) => {
    const isShared = !!ev.sharedByUserId;
    // H2: a suggestion is a nudge (amber edge, dashed: it isn't yours yet); a
    // shared event is told by its dashed neutral edge, not by coral, which
    // is for controls. Text stays foreground so it reads on both grounds.
    if (ev.state === "suggested") {
      return "bg-warning/10 border border-dashed border-warning/60 hover:bg-warning/20 text-foreground";
    }
    if (isShared) {
      return "bg-card border border-dashed border-border hover:bg-accent text-foreground";
    }
    return "bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80";
  };

  // Hearth §13.7 "Row menu": right-click on any block in the grid. The blocks
  // render inline, so the page holds one menu and each block names its own.
  const blockMenuRef = useRef<RowMenu | null>(null);
  const blockMenu = useRowContextMenu(() => blockMenuRef.current);
  const openBlockMenu = (e: React.MouseEvent, menu: RowMenu) => {
    blockMenuRef.current = menu;
    if (blockMenu.onContextMenu(e)) e.stopPropagation();
  };
  const placeActions = (place: string | null | undefined, travelMode?: string | null): RowMenu["actions"] => {
    const p = place?.trim();
    if (!p) return [];
    return [
      { id: "directions", label: "Directions", group: "share", icon: "directions", run: () => window.open(mapsDirectionsUrl(p, travelMode), "_blank", "noopener") },
      { id: "copy", label: "Copy address", group: "share", icon: "copy", run: () => void navigator.clipboard?.writeText(p) },
    ];
  };
  const groupEventMenu = (ev: GroupEvent): RowMenu => ({
    title: ev.title,
    kind: "Event",
    actions: [
      { id: "open", label: "Open", group: "open", icon: "open", run: () => openEventDetail(ev) },
      ...placeActions(ev.location, ev.travel_mode),
      { id: "edit", label: "Edit event", group: "edit", icon: "edit", run: () => openEventDetail(ev) },
      {
        id: "delete",
        label: "Delete",
        group: "danger",
        icon: "delete",
        danger: true,
        run: async () => {
          if (await dialog.confirm({ title: `Delete "${ev.title}"?`, destructive: true })) deleteEventWithCost(ev);
        },
      },
    ],
  });
  const googleEventMenu = (ev: GoogleCalendarEventWithAttribution): RowMenu => ({
    title: ev.title || "Untitled event",
    kind: "Calendar event",
    actions: [
      { id: "open", label: "Open", group: "open", icon: "open", run: () => openCalendarEventDetail(ev) },
      !!ev.html_link && { id: "google", label: "Open in Google Calendar", group: "open", icon: "open", run: () => window.open(ev.html_link as string, "_blank", "noopener") },
      ...placeActions(ev.location),
    ],
  });
  const viewingMenu = (app: Appointment, apt: Apartment | undefined): RowMenu => ({
    title: apt?.address ?? "Viewing",
    kind: "Viewing",
    actions: [
      { id: "listing", label: "Open listing", group: "open", icon: "open", run: () => router.push(`/apartment/${app.apartment_id}`) },
      ...placeActions(apt?.address),
      {
        id: "edit",
        label: "Edit viewing",
        group: "edit",
        icon: "edit",
        run: () => {
          setEditAppointment(app);
          setEditModalOpen(true);
        },
      },
    ],
  });

  const openCalendarEventDetail = (ev: GoogleCalendarEventWithAttribution) => {
    setSelectedCalendarEvent(ev);
    setImportApartmentPickerOpen(false);
    setImportSearchQuery("");
    setCalendarDetailOpen(true);
  };

  // ── Native group events (FLUX-249) ──────────────────────────────────────
  // Kept as its own small overlap-layout helper (rather than generalizing
  // computeCalendarOverlapLayout) so the Google-event rendering path — typed
  // on GoogleCalendarEventWithAttribution — is untouched.

  // Multi-day/group-event day-bounds matching lives in @homeup/core
  // (getEventsForDay/isEventStartDay) so mobile's Day grid + Agenda share the
  // exact same spanning logic (HOUP-112) instead of a second implementation.
  const getEventsForDay = (date: Date) => getEventsForDayCore(groupEvents, date);

  const isAllDayEvent = (ev: GroupEvent) => ev.is_all_day;

  const openEventDetail = (ev: GroupEvent) => {
    setEditEvent(ev);
    setEventModalOpen(true);
  };

  // Week-strip presence dot (FLUX-257): does this day have anything at all —
  // appointment, calendar overlay event, group event, or a to-do due that day?
  const dayHasItems = (date: Date) =>
    calendarDayHasItems(date, { appointments, groupEvents, tasks, calendarEvents: calendarConnected ? calendarEvents : [] });

  /** One row in the mobile Agenda view (FLUX-257): appointments, calendar/group
   *  events, and to-dos due that day, merged into a single time-sorted list.
   *  Mirrors native's agenda-list.tsx: a section tile leads (a checkbox for a
   *  to-do), the meta line is time · one fact. */
  type AgendaItem = {
    key: string;
    sortMinutes: number;
    timeLabel: string;
    /** A clock time (set in mono, T3), as opposed to "All day". */
    timed: boolean;
    title: string;
    subtitle?: string;
    subtitleTone?: "warning";
    /** The owner section's tile: "search" for a viewing, a slot entry's module, else the calendar's. Omitted for tasks (checkbox). */
    sectionId?: string;
    /** A slot entry, for its module's own trailing part (bin lids). */
    entry?: CalendarEntry;
    onClick: () => void;
    task?: HouseholdTask;
    /** A group event, for its forecast. */
    event?: GroupEvent;
  };

  // The day's items come from core's calendarAgenda (shared with native); each maps onto a web row.
  const toAgendaRow = (item: CalendarAgendaItem): AgendaItem => {
    const base = { key: item.key, sortMinutes: item.sortMinutes, timeLabel: item.timeLabel, timed: item.sortMinutes >= 0 };
    switch (item.kind) {
      case "appointment": {
        const { appointment: app, apartment: apt } = item;
        const skipped = app.status === "skipped" || app.status === "rebook";
        return {
          ...base,
          title: apt?.address ?? "Apartment viewing",
          subtitle: skipped ? "Skipped" : app.status === "optional" ? "Optional" : apt?.suburb ?? undefined,
          sectionId: "search",
          onClick: () => router.push(`/apartment/${app.apartment_id}`),
        };
      }
      case "calendarEvent": {
        const ev = item.calendarEvent;
        return {
          ...base,
          title: ev.title || "Untitled event",
          subtitle: ev.state === "suggested" ? "Looks like a viewing" : ev.sharedByUserId ? `Shared by ${memberLabel(ev.sharedByUserId, memberProfiles)}` : undefined,
          subtitleTone: ev.state === "suggested" ? "warning" : undefined,
          sectionId: "calendar",
          onClick: () => openCalendarEventDetail(ev),
        };
      }
      case "event":
        return {
          ...base,
          title: item.event.title,
          subtitle: eventDetailLabel(item.event),
          sectionId: "calendar",
          event: item.event,
          onClick: () => openEventDetail(item.event),
        };
      case "entry":
        return {
          ...base,
          title: item.entry.title,
          subtitle: item.entry.subtitle,
          sectionId: item.entry.moduleId,
          entry: item.entry,
          onClick: () => router.push(item.entry.href),
        };
      case "task":
        return {
          ...base,
          title: item.task.title,
          onClick: () => {
            setEditTask(item.task);
            setTodoModalOpen(true);
          },
          task: item.task,
        };
    }
  };

  const getAgendaItems = (date: Date): AgendaItem[] =>
    calendarAgenda(date, {
      appointments,
      apartments,
      groupEvents,
      tasks,
      calendarEvents: calendarConnected ? calendarEvents : [],
      entries: slotEntries,
    })
      .map(toAgendaRow)
      .sort((a, b) => a.sortMinutes - b.sortMinutes || compareStrings(a.title, b.title));

  const importFilteredApartments = useMemo(() => filterApartments(apartments, importSearchQuery), [apartments, importSearchQuery]);

  const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;

  // Hearth v2 (Pulse): the lede counts what's on a day. On a phone that is the
  // selected day (like native); the desktop week counts today.
  const countForDay = (day: Date) =>
    calendarDayCount(day, { appointments, groupEvents, calendarEvents: calendarConnected ? calendarEvents : [] });
  const todayCount = countForDay(new Date());
  const mobileDayCount = countForDay(mobileDay);

  // All-day items for a day: Google all-day events, all-day group events, and
  // the later days of a multi-day event (its timed block stays on its start
  // day, FLUX-259). They render in a band above the hour grid, not at its
  // midnight edge, so they stay in view when the grid opens on the afternoon.
  type AllDayChip = { key: string; title: string; classes: string; onClick: () => void };
  const getAllDayChips = (day: Date): AllDayChip[] => [
    ...calendarEntriesOn(slotEntries, toISODate(day))
      .filter((entry) => entry.time === null)
      .map((entry) => ({
        key: entry.key,
        title: entry.chipTitle ?? entry.title,
        classes: "border border-border bg-muted text-foreground",
        onClick: () => router.push(entry.href),
      })),
    ...(calendarConnected ? getCalendarEventsForDay(day) : []).filter(isAllDayCalendarEvent).map((ev) => ({
      key: `gcal-${ev.id}`,
      title: ev.title || "Untitled event",
      classes: getCalendarEventClasses(ev),
      onClick: () => openCalendarEventDetail(ev),
    })),
    ...getEventsForDay(day)
      .filter((ev) => isAllDayEvent(ev) || !isEventStartDay(ev, day))
      .map((ev) => ({
        key: `event-${ev.id}`,
        title: ev.title,
        classes: cn("border", eventCategoryClasses(ev.category), "text-foreground"),
        onClick: () => openEventDetail(ev),
      })),
  ];

  const renderAllDayChip = (chip: AllDayChip) => (
    <button
      key={chip.key}
      type="button"
      onClick={chip.onClick}
      title={chip.title}
      className={cn("block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium transition-colors", chip.classes)}
    >
      {chip.title}
    </button>
  );

  const renderDayColumn = (day: Date, dayIndex: number, isMobile: boolean) => {
    const isToday = new Date().toDateString() === day.toDateString();
    const dayAppointments = getAppointmentsForDay(day);
    const layout = computeOverlapLayout(dayAppointments, durationMinutes);
    const slotH = isMobile ? MOBILE_SLOT_HEIGHT : DESKTOP_SLOT_HEIGHT;

    const dayCalendarEvents = calendarConnected ? getCalendarEventsForDay(day) : [];
    const calendarLayout = computeCalendarOverlapLayout(dayCalendarEvents);

    const dayGroupEvents = getEventsForDay(day);
    const groupEventLayout = computeEventOverlapLayout(
      dayGroupEvents.filter((ev) => isEventStartDay(ev, day))
    );
    const now = new Date();
    const nowTop = (now.getHours() + now.getMinutes() / 60 - START_HOUR) * slotH;

    // One timed block's text: time over title, or both on one line when the
    // block is too short for two (COMPACT_BLOCK_PX).
    const blockText = (time: string, title: string, height: number, detail?: string | null) =>
      height < COMPACT_BLOCK_PX ? (
        <div className={`truncate leading-tight ${isMobile ? "text-xs" : "text-[11px]"}`}>
          <span className="font-semibold tabular-nums text-muted-foreground">{time}</span>
          <span className="font-medium"> {title}</span>
        </div>
      ) : (
        <>
          <div className="truncate text-[11px] font-semibold tabular-nums text-muted-foreground">{time}</div>
          <div className={`truncate font-medium ${isMobile ? "text-sm" : "text-xs"}`}>{title}</div>
          {detail && height >= DETAIL_BLOCK_PX && (
            <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
          )}
        </>
      );

    return (
      <div
        key={dayIndex}
        className={`relative border-l select-none ${isToday ? "bg-foreground/[0.025]" : ""}`}
        onPointerDown={(e) => handleSlotPointerDown(dayIndex, isMobile, e)}
        onDoubleClick={isMobile ? undefined : (e) => handleSlotMouseAdd(dayIndex, isMobile, e)}
        onContextMenu={isMobile ? undefined : (e) => handleSlotMouseAdd(dayIndex, isMobile, e)}
      >
        {HOURS.map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-border/40"
            style={{ top: i * slotH }}
          />
        ))}
        {HOURS.map((_, i) => (
          <div
            key={`half-${i}`}
            className="absolute left-0 right-0 border-t border-border/20 border-dashed"
            style={{ top: i * slotH + slotH / 2 }}
          />
        ))}

        {/* Now: a neutral hairline (native's day grid draws the same), never a
            status hue. */}
        {isToday && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 z-30 h-px bg-foreground/60"
            style={{ top: nowTop }}
          />
        )}

        {calendarLayout.map(({ event: ev, start, end, col, totalCols }) => {
          const top = start * slotH + 1;
          const height = Math.max((end - start) * slotH - 2, 20);
          const widthPercent = 100 / totalCols;
          const leftPercent = col * widthPercent;

          return (
            <div
              key={ev.id}
              onClick={(e) => {
                e.stopPropagation();
                openCalendarEventDetail(ev);
              }}
              onContextMenu={(e) => openBlockMenu(e, googleEventMenu(ev))}
              onPointerDown={(e) => e.stopPropagation()}
              className={`absolute z-[15] px-1.5 py-1 rounded-md transition-colors cursor-pointer overflow-hidden ${getCalendarEventClasses(ev)}`}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + 2px)`,
                width: `calc(${widthPercent}% - 4px)`,
              }}
            >
              {blockText(formatClockTime(new Date(ev.starts_at)), ev.title || "Untitled event", height)}
            </div>
          );
        })}

        {groupEventLayout.map(({ event: ev, start, end, col, totalCols }) => {
          const top = start * slotH + 1;
          const height = Math.max((end - start) * slotH - 2, 20);
          const widthPercent = 100 / totalCols;
          const leftPercent = col * widthPercent;

          return (
            <div
              key={ev.id}
              onClick={(e) => {
                e.stopPropagation();
                openEventDetail(ev);
              }}
              onContextMenu={(e) => openBlockMenu(e, groupEventMenu(ev))}
              onPointerDown={(e) => e.stopPropagation()}
              // The category tints the block's fill and border; its text stays
              // foreground so it reads on both grounds (core's text-*-800 is
              // a day-ground colour and vanished on night).
              className={cn(
                "absolute z-[18] px-1.5 py-1 rounded-md border transition-colors cursor-pointer overflow-hidden",
                eventCategoryClasses(ev.category),
                "text-foreground"
              )}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + 2px)`,
                width: `calc(${widthPercent}% - 4px)`,
              }}
            >
              {blockText(formatClockTime(new Date(ev.starts_at)), ev.title, height, ev.location)}
            </div>
          );
        })}

        {layout.map(({ app, start, end, col, totalCols }) => {
          const apt = apartments.find((a) => a.id === app.apartment_id);
          if (!apt) return null;

          const appDate = new Date(app.scheduled_at);
          const top = start * slotH + 1;
          const height = Math.max((end - start) * slotH - 2, 24);
          const widthPercent = 100 / totalCols;
          const leftPercent = col * widthPercent;
          const muted = app.status === "skipped" || app.status === "rebook";

          return (
            <div
              key={app.id}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/apartment/${app.apartment_id}`);
              }}
              onContextMenu={(e) => openBlockMenu(e, viewingMenu(app, apt))}
              onTouchStart={(e) => {
                e.stopPropagation();
                cardTouchRef.current = {
                  moved: false,
                  timer: setTimeout(() => {
                    if (cardTouchRef.current && !cardTouchRef.current.moved) {
                      commit();
                      setEditAppointment(app);
                      setEditModalOpen(true);
                      cardTouchRef.current = null;
                    }
                  }, 600),
                };
              }}
              onTouchMove={() => {
                if (cardTouchRef.current) {
                  cardTouchRef.current.moved = true;
                  if (cardTouchRef.current.timer) clearTimeout(cardTouchRef.current.timer);
                }
              }}
              onTouchEnd={(e) => {
                if (cardTouchRef.current) {
                  if (cardTouchRef.current.timer) clearTimeout(cardTouchRef.current.timer);
                  if (!cardTouchRef.current.moved) {
                    e.preventDefault();
                    router.push(`/apartment/${app.apartment_id}`);
                  }
                  cardTouchRef.current = null;
                }
              }}
              // A viewing is a neutral card in the grid (H2: coral is for
              // controls, amber for status words). An optional one is told by
              // its dashed edge, a skipped one by the done treatment.
              className={cn(
                "absolute z-20 px-1.5 py-1 rounded-md border bg-card text-foreground shadow-sm transition-colors cursor-pointer overflow-hidden hover:bg-accent",
                muted
                  ? "border-border opacity-55 line-through"
                  : app.status === "optional"
                  ? "border-dashed border-muted-foreground/50"
                  : "border-border"
              )}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + 2px)`,
                width: `calc(${widthPercent}% - 4px)`,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {height < COMPACT_BLOCK_PX ? (
                blockText(formatClockTime(appDate), apt.address, height)
              ) : (
                <>
                  <div className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    <Building2 className="h-3 w-3 shrink-0" />
                    {formatClockTime(appDate)}
                  </div>
                  <div className={`font-medium truncate ${isMobile ? "text-sm" : "text-xs"}`}>{apt.address}</div>
                  {apt.suburb && <div className="text-xs text-muted-foreground truncate">{apt.suburb}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const weekAllDay = days.map((day) => getAllDayChips(day));
  const weekHasAllDay = weekAllDay.some((chips) => chips.length > 0);
  const mobileAllDay = getAllDayChips(mobileDay);

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-full mx-auto flex flex-col h-full min-h-[calc(100vh-3.5rem)]">
      {/* Header - stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        {/* Hearth v2 (Pulse, H1): the lede counts what's on a day: the
            selected day on a phone (like native), today on the desktop week. */}
        <div>
          <HeroLede value={mobileDayCount} label={heroDayLabel(mobileDay)} className="md:hidden" />
          <HeroLede value={todayCount} label="on today" className="hidden md:flex" />
          <p className="text-muted-foreground text-sm mt-1 hidden md:block">
            <span className="pointer-fine:hidden">Long-press</span>
            <span className="hidden pointer-fine:inline">Double-click or right-click</span>
            {" "}a time slot to add {calendarAddPhrase({ tasks: showTasks, viewings: showViewings })}
          </p>
        </div>
        {/* Desktop: week navigation */}
        <div className="hidden md:flex items-center gap-1 bg-muted/50 p-1 rounded-xl">
          <Button variant="ghost" size="icon" onClick={prevWeek} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button onClick={goToToday} className="h-8 px-2.5 text-xs font-medium rounded-lg hover:bg-muted transition-colors">
            Today
          </button>
          <button
            onClick={() => setDatePickerOpen(true)}
            className="h-8 min-w-32 px-2 text-center text-sm font-medium tabular-nums rounded-lg hover:bg-muted transition-colors"
          >
            {formatWeekRange(startOfWeek, days[6])}
          </button>
          <Button variant="ghost" size="icon" onClick={nextWeek} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <ModuleSettingsButton moduleId="calendar" className="h-8 w-8 rounded-lg bg-transparent hover:bg-muted" />
        </div>
        {/* Mobile: today + tappable month/year (opens the month picker) */}
        <div className="flex md:hidden items-center gap-1 bg-muted/50 p-1 rounded-xl">
          <button onClick={goToToday} className="h-10 px-3 text-sm font-medium text-muted-foreground rounded-lg hover:bg-muted transition-colors">
            Today
          </button>
          <button
            onClick={() => setDatePickerOpen(true)}
            className="h-10 flex-1 flex items-center justify-center gap-1 text-center text-sm font-semibold rounded-lg hover:bg-muted transition-colors"
          >
            {mobileDay.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <ModuleSettingsButton moduleId="calendar" className="h-10 w-10 rounded-lg bg-transparent hover:bg-muted" />
        </div>
      </div>

      {/* Mobile: sticky swipeable week strip + Day/Agenda toggle (FLUX-257) */}
      <div className="flex md:hidden flex-col gap-2 mb-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            aria-label="Previous week"
            className="flex h-11 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div
            className="grid flex-1 grid-cols-7 gap-1"
            onTouchStart={handleWeekStripTouchStart}
            onTouchEnd={handleWeekStripTouchEnd}
          >
            {days.map((day, i) => {
              const isSelected = i === mobileDayOffset;
              const isToday = new Date().toDateString() === day.toDateString();
              const hasItems = dayHasItems(day);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMobileDayOffset(i)}
                  aria-pressed={isSelected}
                  aria-label={day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  // The picked day is the strip's active state, tinted like
                  // the tab bar's active tab rather than a second coral fill
                  // (H5); today is marked by a neutral ring, not a hue.
                  className={cn(
                    "flex min-h-11 flex-col items-center gap-0.5 rounded-xl py-1.5 transition-colors",
                    isSelected
                      ? "bg-primary/15 text-primary"
                      : isToday
                      ? "text-foreground ring-1 ring-inset ring-border"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <span className={cn("text-[10.5px] font-medium uppercase", isSelected ? "" : "text-muted-foreground")}>
                    {day.toLocaleDateString("en-US", { weekday: "narrow" })}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{day.getDate()}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "h-1 w-1 rounded-full",
                      hasItems ? (isSelected ? "bg-primary" : "bg-muted-foreground/70") : "bg-transparent"
                    )}
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={nextWeek}
            aria-label="Next week"
            className="flex h-11 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <SegmentedControl
          ariaLabel="Calendar view"
          size="sm"
          value={mobileView}
          onChange={setMobileView}
          options={[
            { value: "day", label: "Day" },
            { value: "agenda", label: "Agenda" },
          ]}
        />
      </div>

      {/* Desktop: 7-day grid */}
      <div className="hidden md:flex flex-1 bg-card rounded-3xl border border-border/60 shadow-[var(--card-shadow)] overflow-hidden flex-col min-h-0">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b shrink-0">
          <div className="p-2" />
          {days.map((day, i) => {
            const isToday = new Date().toDateString() === day.toDateString();
            return (
              <div key={i} className="flex flex-col items-center gap-0.5 border-l py-2">
                <div className={cn("text-xs font-medium", isToday ? "text-foreground" : "text-muted-foreground")}>
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                {/* Today: the date in a neutral filled disc (identity of the
                    day, not an action, so not coral; H2). */}
                <div
                  className={cn(
                    "flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-lg font-bold tabular-nums",
                    isToday && "bg-foreground text-background"
                  )}
                >
                  {day.getDate()}
                </div>
              </div>
            );
          })}
          {weekHasAllDay && (
            <>
              <div className="flex items-start justify-end border-t px-2 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                All day
              </div>
              {weekAllDay.map((chips, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-1 border-l border-t p-1">
                  {chips.map(renderAllDayChip)}
                </div>
              ))}
            </>
          )}
        </div>

        <div ref={desktopScrollRef} className="flex-1 overflow-y-auto">
          <div
            className="grid grid-cols-[60px_repeat(7,1fr)] relative"
            style={{ height: HOURS.length * DESKTOP_SLOT_HEIGHT }}
          >
            <div className="relative">
              {HOURS.map((hour, i) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 flex items-start justify-end pr-2 text-xs tabular-nums text-muted-foreground"
                  style={{ top: i * DESKTOP_SLOT_HEIGHT, height: DESKTOP_SLOT_HEIGHT }}
                >
                  {/* The first label sits inside the grid instead of half
                      above it, where the header clipped "12 AM". */}
                  <span className={i === 0 ? "mt-0.5" : "-mt-2"}>{formatHourLabel(hour)}</span>
                </div>
              ))}
            </div>

            {days.map((day, dayIndex) => renderDayColumn(day, dayIndex, false))}
          </div>
        </div>
      </div>

      {/* Mobile: Day (time-grid) or Agenda (flat list) view */}
      <div className="flex md:hidden flex-1 bg-card rounded-3xl border border-border/60 shadow-[var(--card-shadow)] overflow-hidden flex-col min-h-0">
        {mobileView === "day" ? (
          <>
            {mobileAllDay.length > 0 && (
              <div className="flex shrink-0 gap-2 border-b px-3 py-2">
                <span className="w-[38px] shrink-0 pt-0.5 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  All day
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">{mobileAllDay.map(renderAllDayChip)}</div>
              </div>
            )}
            <div ref={columnRef} className="flex-1 overflow-y-auto">
              <div
                className="grid grid-cols-[50px_1fr] relative"
                style={{ height: HOURS.length * MOBILE_SLOT_HEIGHT }}
              >
                <div className="relative">
                  {HOURS.map((hour, i) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 flex items-start justify-end pr-2 text-xs tabular-nums text-muted-foreground"
                      style={{ top: i * MOBILE_SLOT_HEIGHT, height: MOBILE_SLOT_HEIGHT }}
                    >
                      <span className={i === 0 ? "mt-0.5" : "-mt-2"}>{formatHourLabel(hour)}</span>
                    </div>
                  ))}
                </div>

                {renderDayColumn(mobileDay, mobileDayOffset, true)}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {(() => {
              const agendaItems = getAgendaItems(mobileDay);
              if (agendaItems.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center h-full py-12 px-6 text-center">
                    <div className="rounded-2xl bg-primary/10 p-5 mb-4">
                      <CalendarDays className="h-7 w-7 text-primary" />
                    </div>
                    <h2 className="text-base font-semibold mb-1">Nothing scheduled</h2>
                    <p className="text-sm text-muted-foreground max-w-xs mb-5">
                      Long-press a time in Day view, or add {calendarAddPhrase({ tasks: showTasks, viewings: showViewings })}.
                    </p>
                    <button
                      type="button"
                      onClick={openComposeChooser}
                      className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Add something
                    </button>
                  </div>
                );
              }
              return (
                <div className="divide-y divide-border">
                  {agendaItems.map((item) => (
                    <div key={item.key} className="flex min-h-[56px] items-center gap-3 px-3 py-2">
                      {item.task ? (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={item.task.done}
                          aria-label={item.task.done ? "Done, tap to mark not done" : "Tap to mark done"}
                          onClick={() =>
                            patchTask(item.task!.id, {
                              done: !item.task!.done,
                              completed_at: item.task!.done ? null : new Date().toISOString(),
                            })
                          }
                          className="group flex h-11 w-11 -m-[5px] shrink-0 items-center justify-center"
                        >
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition ${
                              item.task.done
                                ? "border-success bg-success text-success-foreground"
                                : "border-border text-transparent group-hover:border-success/60"
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          </span>
                        </button>
                      ) : (
                        // Hearth v2 (§6 feed row): the owner section's tile.
                        <LeadingTile
                          sectionId={item.sectionId ?? "calendar"}
                          Icon={item.sectionId === "search" ? Building2 : sectionIconFor(item.sectionId ?? "calendar")}
                          size="md"
                        />
                      )}
                      <button onClick={item.onClick} className="flex min-w-0 flex-1 items-center text-left">
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm font-medium ${
                              item.task?.done ? "line-through text-muted-foreground" : ""
                            }`}
                          >
                            {item.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {/* T3: mono for a time, never for a word like "All day". */}
                            <span className={item.timed ? "font-mono tabular-nums" : undefined}>{item.timeLabel}</span>
                            {item.subtitle ? (
                              <>
                                {" · "}
                                <span className={item.subtitleTone === "warning" ? "text-warning" : undefined}>{item.subtitle}</span>
                              </>
                            ) : null}
                            {item.event ? <EventForecastSuffix event={item.event} /> : null}
                          </span>
                          {item.event && legOf(item.event.id) ? <LegLine leg={legOf(item.event.id)!} /> : null}
                        </span>
                        {item.entry ? <ModuleRowTrailing moduleId={item.entry.moduleId} detail={item.entry.detail} className="ml-2" /> : null}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Long-press/FAB chooser: "New event" default, "Apartment viewing" / "New
          to-do" as alternates (FLUX-249 rev-2 mockup; was appointment/to-do only
          in FLUX-233 #2). */}
      {chooserOpen && chooserSlot && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setChooserOpen(false)} />
          <div
            className="fixed z-50 w-44 -translate-x-1/2 rounded-lg border bg-card shadow-lg overflow-hidden"
            style={{ left: chooserAnchor.x, top: chooserAnchor.y }}
          >
            <button
              type="button"
              onClick={chooseNewEvent}
              className="w-full min-h-11 text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              New event
            </button>
            {/* Modules: calendar.viewings / calendar.tasks (module-features.ts). */}
            {showViewings && (
              <button
                type="button"
                onClick={chooseNewAppointment}
                className="w-full min-h-11 text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 border-t"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                Apartment viewing
              </button>
            )}
            {showTasks && (
              <button
                type="button"
                onClick={chooseNewTodo}
                className="w-full min-h-11 text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 border-t"
              >
                <ListPlus className="h-3.5 w-3.5 text-muted-foreground" />
                New to-do
              </button>
            )}
          </div>
        </>
      )}

      {/* Modules: adding a to-do from the calendar needs calendar and household (module-features.ts). */}
      {showTasks && todoModalOpen && group && (
        <HouseholdTaskModal
          isOpen={todoModalOpen}
          task={editTask ?? undefined}
          groupId={group.id}
          defaultDueDate={
            !editTask && chooserSlot ? `${chooserSlot.year}-${pad2(chooserSlot.month + 1)}-${pad2(chooserSlot.day)}` : undefined
          }
          defaultDueTime={!editTask && chooserSlot ? `${pad2(chooserSlot.hour)}:${pad2(chooserSlot.minute)}` : undefined}
          onClose={() => {
            setTodoModalOpen(false);
            setEditTask(null);
          }}
          onSave={(task) => {
            writeTask(task);
            setTodoModalOpen(false);
            setEditTask(null);
          }}
          onDelete={(taskId) => {
            deleteTask(taskId);
            setTodoModalOpen(false);
            setEditTask(null);
          }}
        />
      )}

      {eventModalOpen && group && (
        <EventModal
          isOpen={eventModalOpen}
          event={editEvent ?? undefined}
          groupId={group.id}
          defaultDate={
            !editEvent && chooserSlot ? `${chooserSlot.year}-${pad2(chooserSlot.month + 1)}-${pad2(chooserSlot.day)}` : undefined
          }
          defaultTime={!editEvent && chooserSlot ? `${pad2(chooserSlot.hour)}:${pad2(chooserSlot.minute)}` : undefined}
          onClose={() => {
            setEventModalOpen(false);
            setEditEvent(null);
          }}
          showBudget={showBudget}
          costCents={linkedCostOf(editEvent)?.amount ?? null}
          onSave={(ev, costCents) => {
            saveEventWithCost(ev, costCents);
            setEventModalOpen(false);
            setEditEvent(null);
          }}
          onDelete={(eventId) => {
            // The event's Budget line goes with it.
            if (editEvent?.id === eventId) deleteEventWithCost(editEvent);
            setEventModalOpen(false);
            setEditEvent(null);
          }}
        />
      )}

      <MonthDatePicker
        open={datePickerOpen}
        initialDate={currentDate}
        onClose={() => setDatePickerOpen(false)}
        onSelect={(date) => {
          setCurrentDate(date);
          setMobileDayOffset(date.getDay());
          setDatePickerOpen(false);
        }}
        onToday={() => {
          const today = new Date();
          setCurrentDate(today);
          setMobileDayOffset(today.getDay());
          setDatePickerOpen(false);
        }}
      />

      {blockMenu.menu}

      {/* Booking dialog. Modules: booking a viewing needs calendar and search (module-features.ts). */}
      <Dialog open={showViewings && bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book viewing</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Date and time</label>
              <div className="flex items-start justify-center gap-1.5 py-2">
                <ScrollField value={bookingDay} onChange={setBookingDay} min={1} max={getDaysInMonth(bookingYear, bookingMonth)} label="Day" />
                <ScrollField value={bookingMonth} onChange={setBookingMonth} min={0} max={11} label="Month" display={MONTHS[bookingMonth]} />
                <ScrollField value={bookingYear} onChange={setBookingYear} min={2024} max={2030} label="Year" pad={4} wide />
                <div className="w-3 flex items-center justify-center self-center text-muted-foreground font-medium">·</div>
                <ScrollField value={bookingHour} onChange={setBookingHour} min={0} max={23} label="Hour" />
                <div className="self-center text-muted-foreground font-bold mt-[-18px]">:</div>
                <ScrollField value={bookingMinute} onChange={setBookingMinute} min={0} max={55} step={5} label="Min" />
              </div>
              <div className="text-center text-xs text-muted-foreground">
                {new Date(bookingYear, bookingMonth, bookingDay, bookingHour, bookingMinute).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at {new Date(bookingYear, bookingMonth, bookingDay, bookingHour, bookingMinute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Duration</label>
              <SegmentedControl
                ariaLabel="Duration"
                size="sm"
                value={String(bookingDuration)}
                onChange={(v) => setBookingDuration(Number(v))}
                options={([15, 30, 45, 60] as const).map((d) => ({ value: String(d), label: d < 60 ? `${d}m` : "1h" }))}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Apartment</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by address or suburb…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                {filteredApartments.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    No apartments found
                  </div>
                ) : (
                  filteredApartments.map((apt) => {
                    const aptAgent = apt.agent_id
                      ? agents.find((a) => a.id === apt.agent_id)
                      : null;
                    return (
                      <button
                        key={apt.id}
                        onClick={() => handleSelectApartment(apt.id)}
                        aria-pressed={selectedApartmentId === apt.id}
                        className={`w-full text-left p-2.5 hover:bg-muted/50 transition-colors flex items-start gap-2 ${
                          selectedApartmentId === apt.id ? "bg-muted" : ""
                        }`}
                      >
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{apt.address}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            {apt.suburb && <span>{apt.suburb}</span>}
                            {aptAgent && (
                              <span className="flex items-center gap-1">
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: aptAgent.color }}
                                />
                                {aptAgent.name}
                              </span>
                            )}
                          </div>
                        </div>
                        {selectedApartmentId === apt.id && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Agent section */}
            {selectedApartmentId && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">
                  Agent{selectedAgent ? " (from listing)" : ""}
                </label>
                {selectedAgent ? (
                  <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-2.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: selectedAgent.color }}
                    />
                    <span className="font-medium">{selectedAgent.name}</span>
                    {selectedAgent.phone && (
                      <span className="text-muted-foreground">{selectedAgent.phone}</span>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Input
                      placeholder="Agent name"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Input
                      placeholder="Agent phone (optional)"
                      value={agentPhone}
                      onChange={(e) => setAgentPhone(e.target.value)}
                      className="h-9 text-sm"
                    />
                    {agentName.trim() && (
                      <p className="text-xs text-muted-foreground">
                        Agent will be saved to this listing and your settings
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Input
                placeholder="e.g. Bring tape measure"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveBooking} disabled={saving || !selectedApartmentId}>
              {saving ? "Saving…" : "Book"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showViewings && editAppointment && (
        <AppointmentModal
          open={editModalOpen}
          onOpenChange={(open) => {
            setEditModalOpen(open);
            if (!open) setEditAppointment(null);
          }}
          appointment={editAppointment}
          apartmentId={editAppointment.apartment_id}
        />
      )}

      {/* Google Calendar overlay event detail */}
      <Dialog
        open={calendarDetailOpen}
        onOpenChange={(open) => {
          setCalendarDetailOpen(open);
          if (!open) {
            setSelectedCalendarEvent(null);
            setImportApartmentPickerOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {selectedCalendarEvent && (() => {
            const ev = selectedCalendarEvent;
            const isOwn = !ev.sharedByUserId;
            const isAllDay = isAllDayCalendarEvent(ev);
            const startDate = new Date(ev.starts_at);
            const endDate = ev.ends_at ? new Date(ev.ends_at) : null;
            const timeRange = isAllDay
              ? startDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + " · All day"
              : `${startDate.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${startDate.toLocaleTimeString(
                  "en-US",
                  { hour: "numeric", minute: "2-digit" }
                )}${endDate ? ` – ${endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`;

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {ev.title || "Untitled event"}
                    {ev.state === "suggested" && (
                      <span className="text-xs font-medium text-warning">Looks like a viewing</span>
                    )}
                  </DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>{timeRange}</span>
                  </div>
                  {ev.location && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" />
                      <span>{ev.location}</span>
                    </div>
                  )}
                  {!isOwn ? (
                    <div className="text-xs text-muted-foreground">
                      Shared by {memberLabel(ev.sharedByUserId ?? null, memberProfiles)}
                    </div>
                  ) : ev.visibility === "group" ? (
                    <div className="text-xs text-muted-foreground">Shared with your group</div>
                  ) : null}

                  {showViewings && importApartmentPickerOpen && (
                    <div className="grid gap-2 border rounded-lg p-2">
                      <label className="text-xs font-medium text-muted-foreground">Choose an apartment</label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by address or suburb…"
                          value={importSearchQuery}
                          onChange={(e) => setImportSearchQuery(e.target.value)}
                          className="pl-9 h-9 text-sm"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                        {importFilteredApartments.length === 0 ? (
                          <div className="p-3 text-sm text-muted-foreground text-center">No apartments found</div>
                        ) : (
                          importFilteredApartments.map((apt) => (
                            <button
                              key={apt.id}
                              disabled={calendarActionBusy}
                              onClick={() => overlay.importAsAppointment(apt.id)}
                              className="w-full text-left p-2 hover:bg-muted/50 transition-colors flex items-start gap-2 disabled:opacity-50"
                            >
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{apt.address}</div>
                                {apt.suburb && <div className="text-xs text-muted-foreground truncate">{apt.suburb}</div>}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter className="flex-col sm:flex-col gap-2 items-stretch">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!ev.html_link}
                      onClick={() => ev.html_link && window.open(ev.html_link, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      Open in Google Calendar
                    </Button>
                    {isOwn && (
                      <>
                        <Button variant="outline" size="sm" disabled={calendarActionBusy} onClick={overlay.toggleShare}>
                          <Share2 className="h-3.5 w-3.5 mr-1" />
                          {ev.visibility === "group" ? "Unshare" : "Share to group"}
                        </Button>
                        {/* Modules: importing writes a viewing (calendar.viewings) or a to-do (calendar.tasks). */}
                        {showViewings && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={calendarActionBusy || ev.state === "imported"}
                            onClick={() => setImportApartmentPickerOpen((v) => !v)}
                          >
                            <Building2 className="h-3.5 w-3.5 mr-1" />
                            Import as appointment
                          </Button>
                        )}
                        {showTasks && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={calendarActionBusy || ev.state === "imported"}
                            onClick={overlay.importAsTask}
                          >
                            <ListPlus className="h-3.5 w-3.5 mr-1" />
                            Add as to-do
                          </Button>
                        )}
                        {ev.state === "suggested" && (
                          <Button variant="outline" size="sm" disabled={calendarActionBusy} onClick={overlay.dismiss}>
                            <EyeOff className="h-3.5 w-3.5 mr-1" />
                            Dismiss
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The trip from the event before, under an event's agenda line; warning-toned when it won't fit the gap. */
function LegLine({ leg }: { leg: EventLeg }) {
  const minutes = useLegTravel(leg);
  if (typeof minutes !== "number") return null;
  const { text, tight } = legText(leg, minutes);
  return (
    <span className={`mt-0.5 flex items-center gap-1 truncate text-xs ${tight ? "text-warning" : "text-muted-foreground"}`}>
      <Navigation className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** " · 19°, showers" after an agenda event's place, once it's within forecast range. */
function EventForecastSuffix({ event }: { event: GroupEvent }) {
  const forecast = useEventForecast(event);
  return forecast ? <>{` · ${forecast}`}</> : null;
}
