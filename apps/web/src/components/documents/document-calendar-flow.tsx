'use client';

// Documents' "Add to calendar" (household feedback: "should also be able to
// vice versa it from docs into a calendar event"). Web side of
// apps/mobile/src/features/calendar/document-calendar-flow.tsx: a sheet offers
// a new event read from the document (POST /api/parse-event with its
// documentId, then the event form, which links the document when it saves)
// or one of the household's events from today on to link it to.

import { useMemo, useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { toast } from 'sonner';
import { CalendarPlus, Loader2, Sparkles } from 'lucide-react';
import { groupEvents$, linkableEvents, linkEventTicket, useEventSave, useModules, eventWhenText, type GroupEvent, type ParsedEventDetails } from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';
import { EventModal } from '@/app/calendar/event-modal';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { parseEventDocument } from '@/lib/event-parse';
import { cn } from '@/lib/utils';

export interface CalendarDoc {
  id: string;
  title: string | null;
  filename: string;
}

export function DocumentCalendarFlow({
  doc,
  onClose,
  onLinked,
}: {
  /** The document to add; null keeps it closed. */
  doc: CalendarDoc | null;
  onClose: () => void;
  /** After a link is made, so the page can show it on the row. */
  onLinked: () => void;
}) {
  const { group, currentUserId } = useDataCache();
  const modules = useModules();
  const groupId = group?.id;
  const events$ = groupEvents$(groupId);
  const allEvents = use$(() => Object.values(events$.get() ?? {}).filter((e): e is GroupEvent => !!e));
  const events = useMemo(() => linkableEvents(allEvents, currentUserId), [allEvents, currentUserId]);
  const showBudget = modules.feature('calendar.budget');
  const { saveEvent } = useEventSave(groupId, currentUserId, showBudget);

  const [reading, setReading] = useState(false);
  const [form, setForm] = useState<{ details: ParsedEventDetails | null; doc: CalendarDoc } | null>(null);

  const name = doc ? doc.title || doc.filename : '';

  const link = async (event: GroupEvent) => {
    if (!doc || !groupId) return;
    onClose();
    try {
      await linkEventTicket(createClient(), groupId, doc.id, event.id);
      toast.success(`Added to ${event.title}.`);
      onLinked();
    } catch {
      toast.error('Could not link the document.');
    }
  };

  const newEvent = async () => {
    if (!doc) return;
    setReading(true);
    const result = await parseEventDocument(doc.id);
    setReading(false);
    if (!result.ok) toast.error(`${result.error} Fill it in yourself.`);
    setForm({ details: result.ok ? result.details : null, doc });
  };

  const closeForm = () => {
    setForm(null);
    onClose();
  };

  return (
    <>
      <BottomSheet
        open={!!doc && !form}
        onOpenChange={(next) => !next && !reading && onClose()}
        overlayClassName="bg-black/40"
        className={cn(
          'rounded-t-2xl border-t border-border bg-popover/95 text-popover-foreground shadow-2xl shadow-black/50 backdrop-blur-xl',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border'
        )}
        handleClassName="sm:hidden"
      >
        {(contentRef) => (
          <>
            <div className="px-4 pb-2 pt-1 sm:pt-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Add to calendar</p>
              <p className="truncate text-sm text-foreground">{name}</p>
            </div>
            <div ref={contentRef} className="max-h-[50vh] overflow-y-auto px-1.5">
              <ListGroup className="border-0 bg-transparent shadow-none" role="list" aria-label="Add to calendar">
                <ListItem asChild className="cursor-pointer rounded-lg hover:bg-muted/50" role="listitem">
                  <button type="button" disabled={reading} onClick={() => void newEvent()} className="text-left">
                    <ListItemLeading>
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        {reading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      </span>
                    </ListItemLeading>
                    <ListItemContent>
                      <ListItemTitle>New event from this</ListItemTitle>
                      <ListItemMeta>{reading ? 'Reading the document…' : 'Filled in from what it says'}</ListItemMeta>
                    </ListItemContent>
                  </button>
                </ListItem>
                {events.length > 0 && (
                  <p className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Or add it to</p>
                )}
                {events.map((event) => (
                  <ListItem key={event.id} asChild className="cursor-pointer rounded-lg hover:bg-muted/50" role="listitem">
                    <button type="button" disabled={reading} onClick={() => void link(event)} className="text-left">
                      <ListItemLeading>
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <CalendarPlus />
                        </span>
                      </ListItemLeading>
                      <ListItemContent>
                        <ListItemTitle>{event.title}</ListItemTitle>
                        <ListItemMeta>{eventWhenText(event)}</ListItemMeta>
                      </ListItemContent>
                    </button>
                  </ListItem>
                ))}
              </ListGroup>
            </div>
          </>
        )}
      </BottomSheet>

      {form && groupId && (
        <EventModal
          isOpen
          groupId={groupId}
          initialDetails={form.details}
          initialAttachment={form.doc}
          showBudget={showBudget}
          onClose={closeForm}
          onSave={(saved, costCents) => {
            saveEvent(saved, costCents);
            onLinked();
          }}
        />
      )}
    </>
  );
}
