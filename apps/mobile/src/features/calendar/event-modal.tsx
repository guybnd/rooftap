// HOUP-87: native add/edit sheet for a group `events` row (FLUX-249's
// dedicated, group-visible calendar entity — distinct from Appointment and
// HouseholdTask, and the third of the calendar's three embedded modals).
// HOUP-191: migrated off a hand-built BottomSheet shell onto the shared
// `ItemFormSheet` (@homeup/ui) — same header/scrollable-body/sticky-footer
// anatomy as household-task-modal.tsx, incl. its centralized destructive
// confirm + `warn()` haptic (this component's own `dialog.alert` delete
// confirm is gone; `deleteConfirmTitle`/`deleteConfirmMessage` reproduce the
// same copy). Fields/logic are unchanged.
//
// Tickets (event-tickets.tsx): a scanned ticket and any file added here are
// kept in Documents' "Event tickets" folder and linked to the event; existing
// documents can be linked too. Modules: gated on `calendar.event-documents`
// (module-features.ts), as apps/web's event-modal.tsx does.
import * as React from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { Link2, Ticket } from 'lucide-react-native';
import { Text, Button, DateScrollField, DragNumberField, FieldRow, ItemFormSheet, Input, SegmentedControl, TimeScrollField, haptics, toast } from '@homeup/ui';
import {
  EVENT_CATEGORY_META,
  EVENT_REMINDER_OPTIONS,
  applyParsedEvent,
  eventReminderDays,
  looksLikeEventLink,
  mapsSearchUrl,
  todayISO,
  EVENT_DURATION_OPTIONS,
  eventDurationChoice,
  eventDurationMinutes,
  eventEndText,
  withEventDuration,
  withEventStart,
  type EventTiming,
  toggleReminderDay,
  TRAVEL_MODE_OPTIONS,
  travelHint,
  leaveAlertMinutes,
  type TravelMode,
  type EventCategory,
  type GroupEvent,
  currencySymbol,
  type Document,
  type ParsedEventDetails,
  linkEventTicket,
  saveEventTicket,
  useModules,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { parseEventLink, pickAndParseTicket, type EventParseResult } from './event-parse-api';
import { useEventForecast } from './use-event-forecast';
import { useEventTravel } from './use-event-travel';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { EventTickets } from './event-tickets';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const CALENDAR_SECTION = { id: 'calendar', Icon: sectionIconFor('calendar') };

const CATEGORY_OPTIONS = (Object.keys(EVENT_CATEGORY_META) as EventCategory[]).map((value) => ({
  value,
  label: EVENT_CATEGORY_META[value].label,
}));

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoToDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoToTimeStr(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function combineToISO(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

interface EventModalProps {
  open: boolean;
  event?: GroupEvent;
  groupId: string;
  /** Pre-fill the start date for a new event, YYYY-MM-DD (ignored when `event` is provided). */
  defaultDate?: string;
  /** Pre-fill the start time for a new event, HH:MM (ignored when `event` is provided). */
  defaultTime?: string;
  onClose: () => void;
  /** Show the Cost row (calendar.budget: Calendar and Costs both on). */
  showBudget?: boolean;
  /** The event's Budget line amount in cents, when it has one. */
  costCents?: number | null;
  /** `costCents` is the cost on the form (null = none); the screen keeps the Budget line in step. */
  onSave: (event: GroupEvent, costCents: number | null) => void;
  onDelete?: (eventId: string) => void;
  /** A new event made from a document (Documents' "Add to calendar"): what was read from it, applied on open. */
  initialDetails?: ParsedEventDetails | null;
  /** Documents to link once a new event saves. */
  initialTickets?: Document[];
}

export function EventModal({
  open,
  event,
  groupId,
  initialDetails = null,
  initialTickets,
  defaultDate,
  defaultTime,
  showBudget = false,
  costCents = null,
  onClose,
  onSave,
  onDelete,
}: EventModalProps) {
  // The caller remounts this component on `event?.id ?? 'new'` (mirrors
  // household-task-modal.tsx), so these initializers alone re-seed the form.
  const [title, setTitle] = React.useState(event?.title ?? '');
  const [category, setCategory] = React.useState<EventCategory>(event?.category ?? 'general');
  const [visibility, setVisibility] = React.useState<'shared' | 'private'>(event?.private ? 'private' : 'shared');
  const [isAllDay, setIsAllDay] = React.useState(event?.is_all_day ?? false);
  const [startDate, setStartDate] = React.useState(event ? isoToDateStr(event.starts_at) : defaultDate || todayISO());
  const [startTime, setStartTime] = React.useState(event ? isoToTimeStr(event.starts_at) : defaultTime || '09:00');
  const [endDate, setEndDate] = React.useState(event?.ends_at ? isoToDateStr(event.ends_at) : '');
  const [endTime, setEndTime] = React.useState(event?.ends_at ? isoToTimeStr(event.ends_at) : '');
  const [location, setLocation] = React.useState(event?.location ?? '');
  const [notes, setNotes] = React.useState(event?.notes ?? '');
  // Time to leave: new events start on Drive when the household's home is set.
  const { group, userSettings } = useDataCache();
  const [travelMode, setTravelMode] = React.useState<TravelMode | null>(
    event ? event.travel_mode ?? null : group?.home_lat != null && group?.home_lng != null ? 'drive' : null
  );
  const travel = useEventTravel(location, isAllDay ? null : travelMode);

  // Dollars on the form; the Budget keeps cents.
  const [cost, setCost] = React.useState<number | null>(costCents != null ? costCents / 100 : null);
  const [reminderDays, setReminderDays] = React.useState<number[]>(() => eventReminderDays(event ?? {}));

  // The forecast once the event is within range, for the place as typed (debounced).
  const forecast = useEventForecast(
    open && startDate
      ? {
          starts_at: combineToISO(startDate, isAllDay ? '00:00' : startTime || '09:00'),
          is_all_day: isAllDay,
          location,
        }
      : null,
    600
  );

  // Fill from a link or a ticket (household feedback: "add link to event and
  // have it pull details", "or from ticket upload").
  const [eventLink, setEventLink] = React.useState('');
  const [fillBusy, setFillBusy] = React.useState<'link' | 'ticket' | null>(null);

  // Tickets kept with the event (event-tickets.tsx); a new event links its
  // `pendingTickets` when it saves.
  const showDocuments = useModules().feature('calendar.event-documents');
  const [pendingTickets, setPendingTickets] = React.useState<Document[]>(initialTickets ?? []);
  const [ticketsVersion, setTicketsVersion] = React.useState(0);

  const applyFill = (result: EventParseResult) => {
    if (!result.ok) {
      haptics.error();
      toast.error(result.error);
      return false;
    }
    const filled = applyParsedEvent(
      {
        title,
        category,
        start_date: startDate,
        start_time: startTime,
        end_date: endDate,
        end_time: endTime,
        is_all_day: isAllDay,
        location,
        notes,
      },
      result.details
    );
    setTitle(filled.title);
    setCategory(filled.category);
    setStartDate(filled.start_date);
    setStartTime(filled.start_time);
    setEndDate(filled.end_date);
    setEndTime(filled.end_time);
    setIsAllDay(filled.is_all_day);
    setLocation(filled.location);
    setNotes(filled.notes);
    if (showBudget && result.details.price_total !== undefined && !cost) setCost(result.details.price_total);
    haptics.success();
    toast.success('Filled in from what we found. Check it over before saving.');
    return true;
  };

  const fillFromLink = async () => {
    if (!looksLikeEventLink(eventLink)) {
      toast.error('Paste a link to the event page.');
      return;
    }
    setFillBusy('link');
    try {
      applyFill(await parseEventLink(eventLink));
    } finally {
      setFillBusy(null);
    }
  };

  const fillFromTicket = async () => {
    setFillBusy('ticket');
    try {
      const picked = await pickAndParseTicket();
      if (!picked) return;
      // A ticket that filled the form is kept with the event, in Documents' Event tickets folder.
      if (applyFill(picked.result) && showDocuments && picked.file) {
        try {
          const doc = await saveEventTicket({ supabase: getCurrentSupabaseClient(), groupId, input: picked.file, eventId: event?.id ?? null });
          if (event) setTicketsVersion((v) => v + 1);
          else setPendingTickets((prev) => [...prev, doc]);
        } catch {
          toast.error("Filled in, but the ticket couldn't be saved to Documents.");
        }
      }
    } catch {
      toast.error("Couldn't open that file. Try a photo, PDF or calendar file.");
    } finally {
      setFillBusy(null);
    }
  };

  // Made from a document: fill in what was read from it, once.
  const appliedInitial = React.useRef(false);
  React.useEffect(() => {
    if (!open || !initialDetails || event || appliedInitial.current) return;
    appliedInitial.current = true;
    applyFill({ ok: true, details: initialDetails });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDetails, event]);

  // One timing object for the shared duration helpers (core event-duration.ts).
  const timing: EventTiming = {
    start_date: startDate || todayISO(),
    start_time: startTime || '09:00',
    end_date: endDate,
    end_time: endTime,
    is_all_day: isAllDay,
  };
  const setTiming = (t: EventTiming) => {
    setStartDate(t.start_date);
    setStartTime(t.start_time);
    setEndDate(t.end_date);
    setEndTime(t.end_time);
    setIsAllDay(t.is_all_day);
  };
  const durationChoice = eventDurationChoice(timing);
  const [customEnd, setCustomEnd] = React.useState(false);
  const showCustomEnd = !isAllDay && (customEnd || durationChoice === 'custom');
  // Tapping the picked bucket again clears it (no end time).
  const pickDuration = (minutes: number | 'all-day') => {
    setCustomEnd(false);
    setTiming(withEventDuration(timing, durationChoice === minutes ? null : minutes));
  };
  const pickCustom = () => {
    if (showCustomEnd) {
      setCustomEnd(false);
      setTiming(withEventDuration(timing, null));
      return;
    }
    setCustomEnd(true);
    setTiming(withEventDuration(timing, eventDurationMinutes(timing) ?? 60));
  };

  const canSave = title.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const finalStartDate = startDate || todayISO();
    const starts_at = isAllDay ? combineToISO(finalStartDate, '00:00') : combineToISO(finalStartDate, startTime || '09:00');
    const ends_at = !isAllDay && endDate && endTime ? combineToISO(endDate, endTime) : null;
    const costCentsOnForm = showBudget && cost ? Math.round(cost * 100) : null;
    const travelFields = {
      travel_mode: isAllDay ? null : travelMode,
      travel_minutes: isAllDay || !travelMode
        ? null
        : typeof travel.minutes === 'number'
          ? travel.minutes
          : // Still loading on an unchanged trip: keep what was saved.
            travel.minutes === undefined && travelMode === event?.travel_mode && location.trim() === (event?.location ?? '')
            ? event?.travel_minutes ?? null
            : null,
    };

    if (event) {
      onSave({
        ...event,
        title: title.trim(),
        category,
        starts_at,
        ends_at,
        is_all_day: isAllDay,
        location: location.trim() || null,
        notes: notes.trim() || null,
        private: visibility === 'private',
        reminder_days: reminderDays,
        ...travelFields,
      }, costCentsOnForm);
    } else {
      const id = randomUUID();
      onSave({
        id,
        group_id: groupId,
        created_by: null,
        title: title.trim(),
        category,
        starts_at,
        ends_at,
        is_all_day: isAllDay,
        location: location.trim() || null,
        notes: notes.trim() || null,
        private: visibility === 'private',
        reminder_days: reminderDays,
        ...travelFields,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      }, costCentsOnForm);
      if (showDocuments && pendingTickets.length > 0) {
        const supabase = getCurrentSupabaseClient();
        void Promise.all(pendingTickets.map((doc) => linkEventTicket(supabase, groupId, doc.id, id))).catch(() =>
          toast.error('Event saved, but a ticket could not be linked. Add it again from the event.')
        );
      }
    }
  };

  const requestDelete = () => {
    if (!event || !onDelete) return;
    onDelete(event.id);
    onClose();
  };

  return (
    <ItemFormSheet
      section={CALENDAR_SECTION}
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={event ? 'Edit event' : 'New event'}
      previewContent={
        <>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
            {title.trim() || (event ? 'Edit event' : 'New event')}
          </Text>
          <Text className="shrink-0 text-xs font-medium text-muted-foreground">{EVENT_CATEGORY_META[category].label}</Text>
        </>
      }
      onSubmit={save}
      canSubmit={canSave}
      onDelete={event && onDelete ? requestDelete : undefined}
      deleteConfirmTitle={event ? `Delete "${event.title}"?` : undefined}
      deleteConfirmMessage="This can't be undone."
    >
      <FieldRow label="Fill from a link or ticket" hint="Paste the event page, or add a ticket photo, PDF or calendar file.">
        <View className="flex-row gap-1.5">
          <Input
            value={eventLink}
            onChangeText={setEventLink}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => void fillFromLink()}
            className="min-w-0 flex-1"
          />
          <Button variant="outline" size="sm" disabled={!!fillBusy || !eventLink.trim()} onPress={() => void fillFromLink()}>
            {fillBusy === 'link' ? <ActivityIndicator size="small" className="mr-1" /> : <Link2 size={14} className="mr-1 text-foreground" />}
            Fill
          </Button>
          <Button variant="outline" size="sm" disabled={!!fillBusy} onPress={() => void fillFromTicket()}>
            {fillBusy === 'ticket' ? <ActivityIndicator size="small" className="mr-1" /> : <Ticket size={14} className="mr-1 text-foreground" />}
            Ticket
          </Button>
        </View>
      </FieldRow>

      <FieldRow label="Title">
        <Input value={title} onChangeText={setTitle} placeholder="e.g., Night market with friends" autoFocus />
      </FieldRow>

      <FieldRow label="Category">
        <SegmentedControl options={CATEGORY_OPTIONS} value={category} onChange={setCategory} wrap size="sm" />
      </FieldRow>

      <FieldRow label="Visibility">
        <SegmentedControl
          options={[
            { value: 'shared', label: 'Shared' },
            { value: 'private', label: 'Private' },
          ]}
          value={visibility}
          onChange={setVisibility}
        />
      </FieldRow>

      <FieldRow label="Starts">
        {/* Date and time share one card, side by side. */}
        <View className="flex-row flex-wrap items-start justify-center gap-x-4 rounded-lg bg-muted/30 py-2">
          <DateScrollField value={startDate} onChange={(d) => setTiming(withEventStart(timing, d, timing.start_time))} />
          {!isAllDay && (
            <TimeScrollField value={startTime} onChange={(t) => setTiming(withEventStart(timing, timing.start_date, t))} />
          )}
        </View>
      </FieldRow>

      <FieldRow label="Duration" hint={eventEndText(timing) ?? undefined}>
        <View className="gap-1.5">
          <View className="flex-row flex-wrap gap-1.5">
            {EVENT_DURATION_OPTIONS.map((option) => (
              <Button
                key={option.minutes}
                variant={durationChoice === option.minutes && !customEnd ? 'default' : 'outline'}
                size="xs"
                onPress={() => pickDuration(option.minutes)}
              >
                {option.label}
              </Button>
            ))}
            <Button variant={isAllDay ? 'default' : 'outline'} size="xs" onPress={() => pickDuration('all-day')}>
              All day
            </Button>
            <Button variant={showCustomEnd ? 'default' : 'outline'} size="xs" onPress={pickCustom}>
              Custom
            </Button>
          </View>
          {showCustomEnd && (
            <View className="flex-row flex-wrap items-start justify-center gap-x-4 rounded-lg bg-muted/30 py-2">
              <DateScrollField value={endDate} onChange={setEndDate} />
              <TimeScrollField value={endTime || '10:00'} onChange={setEndTime} />
            </View>
          )}
        </View>
      </FieldRow>

      <FieldRow label="Reminders" hint={reminderDays.length === 0 ? 'No reminders for this event.' : undefined}>
        <View className="flex-row flex-wrap gap-1.5">
          {EVENT_REMINDER_OPTIONS.map((option) => (
            <Button
              key={option.days}
              variant={reminderDays.includes(option.days) ? 'default' : 'outline'}
              size="xs"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: reminderDays.includes(option.days) }}
              onPress={() => {
                haptics.tick();
                setReminderDays((days) => toggleReminderDay(days, option.days));
              }}
            >
              {option.label}
            </Button>
          ))}
        </View>
      </FieldRow>

      <FieldRow
        label="Location"
        hint={forecast ? `Forecast: ${forecast}` : undefined}
        action={
          !!location.trim() && (
            <Button variant="ghost" size="xs" onPress={() => void Linking.openURL(mapsSearchUrl(location))}>
              Open in Maps
            </Button>
          )
        }
      >
        <Input value={location} onChangeText={setLocation} placeholder="e.g., Queen Victoria Market" />
      </FieldRow>

      {!isAllDay && (
        <FieldRow
          label="Getting there"
          hint={travelHint({
            mode: travelMode,
            hasHome: travel.hasHome,
            hasPlace: !!location.trim(),
            minutes: travel.minutes,
            startsAt: combineToISO(startDate || todayISO(), startTime || '09:00'),
            alertMinutes: leaveAlertMinutes(userSettings),
            formatClock: (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          })}
        >
          <SegmentedControl
            options={TRAVEL_MODE_OPTIONS}
            value={travelMode ?? 'off'}
            onChange={(v) => setTravelMode(v === 'off' ? null : v)}
          />
        </FieldRow>
      )}

      {showBudget && (
        <FieldRow label="Cost" hint={cost ? 'Kept in the Budget as Going out.' : 'Add what the tickets cost to keep it in the Budget.'}>
          <DragNumberField
            value={cost}
            onChange={setCost}
            step={1}
            min={0}
            precision={2}
            prefix={currencySymbol()}
            placeholder="0.00"
            accessibilityLabel="Cost"
          />
        </FieldRow>
      )}

      <FieldRow label="Notes">
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional details…"
          multiline
          numberOfLines={3}
          className="h-20 py-2"
          textAlignVertical="top"
        />
      </FieldRow>

      {showDocuments && (
        <EventTickets
          open={open}
          groupId={groupId}
          eventId={event?.id ?? null}
          pending={pendingTickets}
          onPendingChange={setPendingTickets}
          version={ticketsVersion}
        />
      )}
    </ItemFormSheet>
  );
}
