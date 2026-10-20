// Documents' "Add to calendar" (household feedback: "should also be able to
// vice versa it from docs into a calendar event"). A sheet offers a new event
// read from the document (POST /api/parse-event with its documentId, then the
// event form, with the document linked once it saves) or one of the
// household's events from today on to link it to. The Documents screen only
// opens this with a document and reloads its links when it's done.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { CalendarPlus, Sparkles } from 'lucide-react-native';
import {
  groupEvents$,
  MOTION_DURATIONS_MS,
  linkableEvents,
  linkEventTicket,
  useEventSave,
  useModules,
  type Document,
  type GroupEvent,
  type ParsedEventDetails,
  type UnifiedDocument,
} from '@homeup/core';
import {
  BottomSheet,
  BottomSheetScrollView,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  Text,
  haptics,
  toast,
} from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { EventModal } from './event-modal';
import { parseEventDocument } from './event-parse-api';

function whenText(event: GroupEvent): string {
  const start = new Date(event.starts_at);
  const day = start.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  if (event.is_all_day) return day;
  return `${day}, ${start.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase()}`;
}

export function DocumentCalendarFlow({
  doc,
  onClose,
  onLinked,
}: {
  /** The document to add (a store row: legacy files are adopted first); null keeps it closed. */
  doc: UnifiedDocument | null;
  onClose: () => void;
  /** After a link is made, so the screen can show it on the row. */
  onLinked: () => void;
}) {
  const { group, currentUserId } = useDataCache();
  const modules = useModules();
  const groupId = group?.id;
  const events$ = groupEvents$(groupId);
  const allEvents = use$(() => Object.values(events$.get() ?? {}).filter((e): e is GroupEvent => !!e));
  const events = React.useMemo(() => linkableEvents(allEvents, currentUserId), [allEvents, currentUserId]);
  const showBudget = modules.feature('calendar.budget');
  const { saveEvent } = useEventSave(groupId, currentUserId, showBudget);

  const [reading, setReading] = React.useState(false);
  const [form, setForm] = React.useState<{ details: ParsedEventDetails | null; ticket: Document } | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);

  const sheetOpen = !!doc && !formOpen;
  const name = doc ? doc.title || doc.filename : '';

  const link = async (event: GroupEvent) => {
    if (!doc?.storeId || !groupId) return;
    try {
      await linkEventTicket(getCurrentSupabaseClient(), groupId, doc.storeId, event.id);
      haptics.success();
      toast.success(`Added to ${event.title}.`);
      onLinked();
    } catch {
      toast.error('Could not link the document.');
    }
    onClose();
  };

  const newEvent = async () => {
    if (!doc?.storeId) return;
    setReading(true);
    const result = await parseEventDocument(doc.storeId);
    setReading(false);
    if (!result.ok) toast.error(`${result.error} Fill it in yourself.`);
    // The form links the document when the event saves (event-tickets.tsx).
    const ticket = {
      id: doc.storeId,
      group_id: doc.groupId,
      title: doc.title,
      filename: doc.filename,
      storage_path: doc.storagePath,
      source: doc.source,
    } as Document;
    setForm({ details: result.ok ? result.details : null, ticket });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    onClose();
    setTimeout(() => setForm(null), MOTION_DURATIONS_MS.exit);
  };

  return (
    <>
      <BottomSheet open={sheetOpen} onOpenChange={(next) => !next && !reading && onClose()} className="pb-2">
        <View className="border-b border-border px-4 pb-3">
          <Text className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Add to calendar</Text>
          <Text numberOfLines={1} className="text-body text-foreground">
            {name}
          </Text>
        </View>
        <BottomSheetScrollView style={{ maxHeight: 420 }}>
          <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
            <ListItem onPress={reading ? undefined : () => void newEvent()}>
              <ListItemLeading>
                {reading ? <ActivityIndicator size="small" /> : <Sparkles size={16} className="text-foreground" />}
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>New event from this</ListItemTitle>
                <ListItemMeta>
                  <Text className="text-caption text-muted-foreground">{reading ? 'Reading the document…' : 'Filled in from what it says'}</Text>
                </ListItemMeta>
              </ListItemContent>
            </ListItem>
            {events.length > 0 && (
              <Text className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Or add it to</Text>
            )}
            {events.map((event) => (
              <ListItem key={event.id} onPress={reading ? undefined : () => void link(event)}>
                <ListItemLeading>
                  <CalendarPlus size={16} className="text-foreground" />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle numberOfLines={1}>{event.title}</ListItemTitle>
                  <ListItemMeta>
                    <Text className="text-caption text-muted-foreground">{whenText(event)}</Text>
                  </ListItemMeta>
                </ListItemContent>
              </ListItem>
            ))}
          </ListGroup>
        </BottomSheetScrollView>
      </BottomSheet>

      {form && groupId && (
        <EventModal
          key={form.ticket.id}
          open={formOpen}
          groupId={groupId}
          initialDetails={form.details}
          initialTickets={[form.ticket]}
          showBudget={showBudget}
          onClose={closeForm}
          onSave={(saved, costCents) => {
            saveEvent(saved, costCents);
            onLinked();
            closeForm();
          }}
        />
      )}
    </>
  );
}
