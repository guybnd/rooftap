'use client';

// FLUX-249: "New event" / "Edit event" modal for the dedicated, group-visible
// `events` entity. Clones the household-task-modal.tsx shape (local build +
// onSave/onDelete, no direct Supabase writes for the event row itself — the
// calendar page routes those through the Legend store). The optional file
// attachment is the one part that IS a direct, async Supabase call (reusing
// the central documents/document_links store), since attachments are
// inherently online — see the two-mode "pick existing / upload new" section.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Link2, Loader2, Plus, Ticket, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  listDocuments,
  fileUploadInput,
  linkDocument,
  validateDocumentFile,
  docTypeLabel,
  DOCUMENT_ACCEPT_ATTR,
  DOCUMENT_MAX_LABEL,
} from '@/lib/documents';
import { LinkedDocuments } from '@/components/documents/linked-documents';
import { todayISO } from '@/app/tasks/moving-tasks';
import { DateScrollField } from '@/components/date-scroll-field';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { TimeScrollField } from '@/components/time-scroll-field';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchablePicker } from '@/components/ui/searchable-picker';
import {
  EVENT_CATEGORY_PICKER_OPTIONS,
  EVENT_DURATION_OPTIONS,
  EVENT_REMINDER_OPTIONS,
  eventDurationChoice,
  eventDurationMinutes,
  eventEndText,
  withEventDuration,
  withEventStart,
  applyParsedEvent,
  eventReminderDays,
  looksLikeEventLink,
  mapsSearchUrl,
  toggleReminderDay,
  TRAVEL_MODE_OPTIONS,
  travelHint,
  leaveAlertMinutes,
  saveEventTicket,
  EVENT_TICKETS_FOLDER_NAME,
  type TravelMode,
  useModules,
  currencySymbol,
} from '@homeup/core';
import { dialog } from '@homeup/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isCalendarFile, parseEventFile, parseEventLink, type EventParseResult } from '@/lib/event-parse';
import { useEventForecast } from '@/lib/use-event-forecast';
import { useEventTravel } from '@/lib/use-event-travel';
import { useDataCache } from '@/lib/data-cache';
import type { Document, EventCategory, GroupEvent, ParsedEventDetails } from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const CALENDAR_SECTION = { id: 'calendar', Icon: sectionIconFor('calendar') };

interface EventModalProps {
  isOpen: boolean;
  event?: GroupEvent;
  groupId: string;
  /** Pre-fill the start date for new events, YYYY-MM-DD (ignored when `event` is provided). */
  defaultDate?: string;
  /** Pre-fill the start time for new events, HH:MM (ignored when `event` is provided). */
  defaultTime?: string;
  onClose: () => void;
  /** Show the Cost row (calendar.budget: Calendar and Costs both on). */
  showBudget?: boolean;
  /** The event's Budget line amount in cents, when it has one. */
  costCents?: number | null;
  /** `costCents` is the cost on the form (null = none); the page keeps the Budget line in step. */
  onSave: (event: GroupEvent, costCents: number | null) => void;
  onDelete?: (eventId: string) => void;
  /** A new event made from a document (Documents' "Add to calendar"): what was read from it. */
  initialDetails?: ParsedEventDetails | null;
  /** A document to link once a new event saves. */
  initialAttachment?: AttachmentDoc | null;
}

type AttachmentDoc = Pick<Document, 'id' | 'title' | 'filename'>;

function pad2(n: number) {
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

export function EventModal({
  isOpen,
  event,
  groupId,
  defaultDate,
  defaultTime,
  showBudget = false,
  costCents = null,
  onClose,
  onSave,
  onDelete,
  initialDetails = null,
  initialAttachment = null,
}: EventModalProps) {
  const isNew = !event;
  // Modules: attaching documents to an event needs calendar and documents
  // (module-features.ts). Off, the Attachment section and its fetch are skipped.
  const showDocuments = useModules().feature('calendar.event-documents');

  // Time to leave: new events start on Drive when the household's home is set.
  const { group, userSettings } = useDataCache();
  const hasHome = group?.home_lat != null && group?.home_lng != null;

  const buildInitialForm = useCallback(() => {
    const form = {
      title: event?.title || '',
      category: (event?.category ?? 'general') as EventCategory,
      private: event?.private ?? false,
      start_date: event ? isoToDateStr(event.starts_at) : defaultDate || todayISO(),
      start_time: event ? isoToTimeStr(event.starts_at) : defaultTime || '09:00',
      end_date: event?.ends_at ? isoToDateStr(event.ends_at) : '',
      end_time: event?.ends_at ? isoToTimeStr(event.ends_at) : '',
      is_all_day: event?.is_all_day ?? false,
      location: event?.location || '',
      notes: event?.notes || '',
      reminder_days: eventReminderDays(event ?? {}),
      // Dollars on the form; the Budget keeps cents.
      cost: costCents != null ? costCents / 100 : (null as number | null),
      travel_mode: (event ? event.travel_mode ?? null : hasHome ? 'drive' : null) as TravelMode | null,
    };
    if (event || !initialDetails) return form;
    // Made from a document: start from what was read from it.
    const price = initialDetails.price_total;
    return { ...applyParsedEvent(form, initialDetails), cost: showBudget && price !== undefined ? price : form.cost };
  }, [event, defaultDate, defaultTime, costCents, hasHome, initialDetails, showBudget]);

  const [formData, setFormData] = useState(buildInitialForm);

  // Reseed on every closed→open transition (FLUX-186 pattern from household-task-modal).
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setFormData(buildInitialForm());
    wasOpen.current = isOpen;
  }, [isOpen, buildInitialForm]);

  // ── Attachment (pick existing / upload new) ──────────────────────────────
  const [groupDocuments, setGroupDocuments] = useState<Document[]>([]);
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentDoc | null>(initialAttachment);
  const [attachBusy, setAttachBusy] = useState(false);
  const [linkedDocsVersion, setLinkedDocsVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !groupId || !showDocuments) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const docs = await listDocuments(supabase, groupId);
      if (!cancelled) setGroupDocuments(docs);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, groupId, showDocuments]);

  useEffect(() => {
    if (isOpen && !wasOpen.current) setPendingAttachment(initialAttachment);
  }, [isOpen, initialAttachment]);

  const existingDocOptions = useMemo(
    () =>
      groupDocuments.map((d) => ({
        value: d.id,
        primary: d.title || d.filename,
        secondary: docTypeLabel(d.doc_type),
      })),
    [groupDocuments]
  );

  const handlePickExisting = useCallback(
    async (documentId: string) => {
      const doc = groupDocuments.find((d) => d.id === documentId);
      if (!doc) return;
      if (isNew) {
        setPendingAttachment(doc);
        return;
      }
      setAttachBusy(true);
      try {
        const supabase = createClient();
        await linkDocument({ supabase, documentId: doc.id, groupId, entityType: 'event', entityId: event!.id });
        setLinkedDocsVersion((v) => v + 1);
        toast.success('Document linked.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not link the document.');
      } finally {
        setAttachBusy(false);
      }
    },
    [groupDocuments, isNew, groupId, event]
  );

  const attachFile = useCallback(
    async (file: File) => {
      const validationError = validateDocumentFile(file);
      if (validationError) {
        toast.error(validationError);
        return;
      }
      setAttachBusy(true);
      try {
        // Into Docs' "Event tickets" folder, linked now or once a new event saves.
        const supabase = createClient();
        const doc = await saveEventTicket({ supabase, groupId, input: fileUploadInput(file), eventId: isNew ? null : event!.id });
        if (isNew) setPendingAttachment(doc);
        else setLinkedDocsVersion((v) => v + 1);
        toast.success(`Saved to ${EVENT_TICKETS_FOLDER_NAME} in Documents.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      } finally {
        setAttachBusy(false);
      }
    },
    [groupId, isNew, event]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) void attachFile(file);
    },
    [attachFile]
  );

  // The forecast once the event is within range, for the place as typed (debounced).
  const forecast = useEventForecast(
    isOpen && formData.start_date
      ? {
          starts_at: combineToISO(formData.start_date, formData.is_all_day ? '00:00' : formData.start_time || '09:00'),
          is_all_day: formData.is_all_day,
          location: formData.location,
        }
      : null,
    600
  );

  const travel = useEventTravel(formData.location, formData.is_all_day ? null : formData.travel_mode);

  // ── Fill from a link or a ticket ─────────────────────────────────────────
  const [eventLink, setEventLink] = useState('');
  const [fillBusy, setFillBusy] = useState<'link' | 'ticket' | null>(null);
  const ticketInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && !wasOpen.current) setEventLink('');
  }, [isOpen]);

  const applyFill = (result: EventParseResult) => {
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    const price = result.details.price_total;
    setFormData((f) => ({
      ...applyParsedEvent(f, result.details),
      cost: showBudget && price !== undefined && !f.cost ? price : f.cost,
    }));
    toast.success('Filled in from what we found. Check it over before saving.');
    return true;
  };

  const handleFillFromLink = async () => {
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

  const handleTicketChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFillBusy('ticket');
    try {
      const filled = applyFill(await parseEventFile(file));
      // Keep the ticket with the event when Documents is on (a calendar file isn't worth keeping).
      if (filled && showDocuments && !isCalendarFile(file)) void attachFile(file);
    } finally {
      setFillBusy(null);
    }
  };

  const linkPendingAttachment = useCallback(
    async (eventId: string) => {
      if (!pendingAttachment) return;
      try {
        const supabase = createClient();
        await linkDocument({ supabase, documentId: pendingAttachment.id, groupId, entityType: 'event', entityId: eventId });
      } catch {
        toast.error('Event saved, but the attachment could not be linked. Try attaching it again from the event.');
      }
    },
    [pendingAttachment, groupId]
  );

  // ── Duration (core event-duration.ts) ─────────────────────────────────────
  const durationChoice = eventDurationChoice(formData);
  const [customEnd, setCustomEnd] = useState(false);
  const showCustomEnd = !formData.is_all_day && (customEnd || durationChoice === 'custom');
  // Picking the chosen bucket again clears it (no end time).
  const pickDuration = (minutes: number | 'all-day') => {
    setCustomEnd(false);
    setFormData((f) => withEventDuration(f, eventDurationChoice(f) === minutes ? null : minutes));
  };
  const pickCustom = () => {
    if (showCustomEnd) {
      setCustomEnd(false);
      setFormData((f) => withEventDuration(f, null));
      return;
    }
    setCustomEnd(true);
    setFormData((f) => withEventDuration(f, eventDurationMinutes(f) ?? 60));
  };
  const chipClass = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
      active ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
    );

  const handleSubmit = () => {
    if (!formData.title.trim()) return;

    const start_date = formData.start_date || todayISO();
    const title = formData.title.trim();
    const location = formData.location.trim() || null;
    const notes = formData.notes.trim() || null;
    const costCentsOnForm = showBudget && formData.cost ? Math.round(formData.cost * 100) : null;
    const travelMode = formData.is_all_day ? null : formData.travel_mode;
    const travelFields = {
      travel_mode: travelMode,
      travel_minutes: !travelMode
        ? null
        : typeof travel.minutes === 'number'
          ? travel.minutes
          : // Still loading on an unchanged trip: keep what was saved.
            travel.minutes === undefined && travelMode === event?.travel_mode && formData.location.trim() === (event?.location ?? '')
            ? event?.travel_minutes ?? null
            : null,
    };
    const starts_at = formData.is_all_day
      ? combineToISO(start_date, '00:00')
      : combineToISO(start_date, formData.start_time || '09:00');
    const ends_at =
      !formData.is_all_day && formData.end_date && formData.end_time
        ? combineToISO(formData.end_date, formData.end_time)
        : null;

    if (event?.id) {
      onSave({
        ...event,
        title,
        category: formData.category,
        starts_at,
        ends_at,
        is_all_day: formData.is_all_day,
        location,
        notes,
        private: formData.private,
        reminder_days: formData.reminder_days,
        ...travelFields,
      }, costCentsOnForm);
    } else {
      const newEvent: GroupEvent = {
        id: crypto.randomUUID(),
        group_id: groupId,
        created_by: null, // useStoreHelpers.writeRow fills this from currentUserId
        title,
        category: formData.category,
        starts_at,
        ends_at,
        is_all_day: formData.is_all_day,
        location,
        notes,
        private: formData.private,
        reminder_days: formData.reminder_days,
        ...travelFields,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      };
      onSave(newEvent, costCentsOnForm);
      if (showDocuments && pendingAttachment) void linkPendingAttachment(newEvent.id);
    }

    onClose();
  };

  const handleDelete = async () => {
    if (!event?.id || !onDelete) return;
    if (!(await dialog.confirm({ title: `Delete "${event.title}"?`, message: 'This cannot be undone.', destructive: true }))) return;
    onDelete(event.id);
    onClose();
  };

  return (
    <ItemFormSheet
      section={CALENDAR_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      previewContent={
        <>
          {/* E1: the header states the item (native does the same). */}
          <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
            {formData.title.trim() || (event ? 'Edit event' : 'New event')}
          </span>
          <SearchablePicker
            options={EVENT_CATEGORY_PICKER_OPTIONS}
            value={formData.category}
            onChange={(category) => setFormData({ ...formData, category: category as EventCategory })}
            placeholder="General"
            searchPlaceholder="Search categories…"
            ariaLabel="Category"
            className="w-32 shrink-0"
          />
        </>
      }
      onSubmit={handleSubmit}
      canSubmit={!!formData.title.trim()}
      onDelete={event && onDelete ? handleDelete : undefined}
    >
      <FormSection>
        <FieldRow label="Fill from a link or ticket" htmlFor="event-link" hint="Paste the event page, or add a ticket photo, PDF or calendar file.">
          <div className="flex gap-1.5">
            <Input
              id="event-link"
              type="url"
              inputMode="url"
              value={eventLink}
              onChange={(e) => setEventLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleFillFromLink();
                }
              }}
              placeholder="https://"
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!!fillBusy || !eventLink.trim()}
              onClick={() => void handleFillFromLink()}
            >
              {fillBusy === 'link' ? <Loader2 className="animate-spin" /> : <Link2 />}
              Fill
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!!fillBusy}
              onClick={() => ticketInputRef.current?.click()}
            >
              {fillBusy === 'ticket' ? <Loader2 className="animate-spin" /> : <Ticket />}
              Ticket
            </Button>
            <input
              ref={ticketInputRef}
              type="file"
              accept="image/*,application/pdf,text/calendar,.ics"
              className="hidden"
              onChange={(e) => void handleTicketChange(e)}
            />
          </div>
        </FieldRow>

        <FieldRow label="Title" htmlFor="event-title" required>
          <Input
            id="event-title"
            autoFocus
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Night market with friends"
          />
        </FieldRow>

        <FieldRow label="Visibility">
          <SegmentedControl
            options={[
              { value: 'shared', label: 'Shared' },
              { value: 'private', label: 'Private' },
            ]}
            value={formData.private ? 'private' : 'shared'}
            onChange={(v) => setFormData({ ...formData, private: v === 'private' })}
            ariaLabel="Visibility"
          />
        </FieldRow>

        <FieldRow label="Starts" required>
          {/* Date and time share one row. */}
          <div className="flex flex-wrap items-start justify-center gap-x-6 py-2">
            <DateScrollField
              value={formData.start_date}
              onChange={(v) => setFormData((f) => withEventStart(f, v, f.start_time || '09:00'))}
            />
            {!formData.is_all_day && (
              <TimeScrollField
                value={formData.start_time}
                onChange={(v) => setFormData((f) => withEventStart(f, f.start_date || todayISO(), v))}
              />
            )}
          </div>
        </FieldRow>

        <FieldRow label="Duration" hint={eventEndText({ ...formData, start_date: formData.start_date || todayISO() }) ?? undefined}>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_DURATION_OPTIONS.map((option) => {
              const active = durationChoice === option.minutes && !customEnd;
              return (
                <button key={option.minutes} type="button" aria-pressed={active} onClick={() => pickDuration(option.minutes)} className={chipClass(active)}>
                  {option.label}
                </button>
              );
            })}
            <button type="button" aria-pressed={formData.is_all_day} onClick={() => pickDuration('all-day')} className={chipClass(formData.is_all_day)}>
              All day
            </button>
            <button type="button" aria-pressed={showCustomEnd} onClick={pickCustom} className={chipClass(showCustomEnd)}>
              Custom
            </button>
          </div>
          {showCustomEnd && (
            <div className="mt-2 flex flex-wrap items-start justify-center gap-x-6 py-2">
              <DateScrollField value={formData.end_date} onChange={(v) => setFormData((f) => ({ ...f, end_date: v }))} />
              <TimeScrollField value={formData.end_time || '10:00'} onChange={(v) => setFormData((f) => ({ ...f, end_time: v }))} />
            </div>
          )}
        </FieldRow>
      </FormSection>

      <FormSection title="Details">
        <FieldRow label="Reminders" hint={formData.reminder_days.length === 0 ? 'No reminders for this event.' : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_REMINDER_OPTIONS.map((option) => {
              const active = formData.reminder_days.includes(option.days);
              return (
                <button
                  key={option.days}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() =>
                    setFormData((f) => ({ ...f, reminder_days: toggleReminderDay(f.reminder_days, option.days) }))
                  }
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow
          label="Location"
          hint={forecast ? `Forecast: ${forecast}` : undefined}
          action={
            formData.location.trim() ? (
              <a
                href={mapsSearchUrl(formData.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline"
              >
                Open in Maps
              </a>
            ) : undefined
          }
        >
          <Input
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            placeholder="e.g., Queen Victoria Market"
          />
        </FieldRow>

        {!formData.is_all_day && (
          <FieldRow
            label="Getting there"
            hint={travelHint({
              mode: formData.travel_mode,
              hasHome: travel.hasHome,
              hasPlace: !!formData.location.trim(),
              minutes: travel.minutes,
              startsAt: combineToISO(formData.start_date || todayISO(), formData.start_time || '09:00'),
              alertMinutes: leaveAlertMinutes(userSettings),
              formatClock: (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            })}
          >
            <SegmentedControl
              options={TRAVEL_MODE_OPTIONS}
              value={formData.travel_mode ?? 'off'}
              onChange={(v) => setFormData((f) => ({ ...f, travel_mode: v === 'off' ? null : (v as TravelMode) }))}
            />
          </FieldRow>
        )}

        {showBudget && (
          <FieldRow
            label="Cost"
            hint={formData.cost ? 'Kept in the Budget as Going out.' : 'Add what the tickets cost to keep it in the Budget.'}
          >
            <DragNumberField
              value={formData.cost}
              onChange={(cost) => setFormData((f) => ({ ...f, cost }))}
              step={1}
              min={0}
              precision={2}
              prefix={currencySymbol()}
              placeholder="0.00"
              ariaLabel="Cost"
            />
          </FieldRow>
        )}

        <FieldRow label="Notes">
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
            placeholder="Any additional details…"
            rows={3}
          />
        </FieldRow>
      </FormSection>

      {showDocuments && (
        <FormSection title="Tickets">
          {!isNew && event && <LinkedDocuments key={linkedDocsVersion} entityType="event" entityId={event.id} />}

          {pendingAttachment && (
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{pendingAttachment.title || pendingAttachment.filename}</span>
              <button
                type="button"
                onClick={() => setPendingAttachment(null)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <SearchablePicker
              options={existingDocOptions}
              value={null}
              onChange={handlePickExisting}
              placeholder="Choose existing…"
              searchPlaceholder="Search documents…"
              emptyText="No documents yet"
              ariaLabel="Choose existing document"
              disabled={attachBusy}
              className="flex-1"
            />
            <Button type="button" variant="outline" size="sm" disabled={attachBusy} onClick={() => fileInputRef.current?.click()}>
              Upload new
            </Button>
          </div>
          <input ref={fileInputRef} type="file" accept={DOCUMENT_ACCEPT_ATTR} className="hidden" onChange={handleFileChange} />
          <p className="text-xs text-muted-foreground">PDF/JPG/PNG · up to {DOCUMENT_MAX_LABEL}</p>
        </FormSection>
      )}
    </ItemFormSheet>
  );
}
