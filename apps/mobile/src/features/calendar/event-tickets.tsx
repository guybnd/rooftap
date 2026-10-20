// The event form's Tickets section (household feedback: "from an event edit,
// upload a ticket and save it, not for parsing, just to have it handy, or
// select one from my docs"). Native side of web's Attachment section in
// apps/web/src/app/calendar/event-modal.tsx. A new file goes to Documents'
// "Event tickets" folder (core event-tickets.ts); picking an existing document
// only links it. Links are live for a saved event; a new event holds them as
// `pending` until it saves (the form links them then).
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { FileText, Plus, X } from 'lucide-react-native';
import {
  docTypeLabel,
  documentBucket,
  EVENT_TICKETS_FOLDER_NAME,
  listDocuments,
  listDocumentsForEntity,
  linkEventTicket,
  saveEventTicket,
  unlinkDocument,
  type Document,
} from '@homeup/core';
import { Button, FieldRow, SearchablePicker, Text, haptics, toast } from '@homeup/ui';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { openDocumentExternally } from '@/components/documents/document-preview';
import { pickTicketFile } from './event-parse-api';

export interface EventTicketsProps {
  open: boolean;
  groupId: string;
  /** The saved event, or null while it's new. */
  eventId: string | null;
  pending: Document[];
  onPendingChange: (next: Document[]) => void;
  /** Bumped by the form when it saved a scanned ticket, so the list reloads. */
  version: number;
}

export function EventTickets({ open, groupId, eventId, pending, onPendingChange, version }: EventTicketsProps) {
  const [linked, setLinked] = React.useState<Document[]>([]);
  const [groupDocs, setGroupDocs] = React.useState<Document[]>([]);
  const [reload, setReload] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const supabase = getCurrentSupabaseClient();
    void Promise.all([
      listDocuments(supabase, groupId),
      eventId ? listDocumentsForEntity(supabase, 'event', eventId) : Promise.resolve([] as Document[]),
    ])
      .then(([docs, forEvent]) => {
        if (cancelled) return;
        setGroupDocs(docs);
        setLinked(forEvent);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, groupId, eventId, reload, version]);

  const shown = eventId ? linked : pending;
  const shownIds = new Set(shown.map((d) => d.id));
  const options = groupDocs
    .filter((d) => !shownIds.has(d.id))
    .map((d) => ({ value: d.id, primary: d.title || d.filename, secondary: docTypeLabel(d.doc_type) }));

  const addFile = async () => {
    let input;
    try {
      input = await pickTicketFile();
    } catch {
      toast.error("Couldn't open that file. Try a photo or PDF.");
      return;
    }
    if (!input) return;
    setBusy(true);
    try {
      const doc = await saveEventTicket({ supabase: getCurrentSupabaseClient(), groupId, input, eventId });
      if (eventId) setReload((v) => v + 1);
      else onPendingChange([...pending, doc]);
      haptics.success();
      toast.success(`Saved to ${EVENT_TICKETS_FOLDER_NAME} in Documents.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickExisting = async (documentId: string) => {
    const doc = groupDocs.find((d) => d.id === documentId);
    if (!doc) return;
    if (!eventId) {
      onPendingChange([...pending, doc]);
      return;
    }
    setBusy(true);
    try {
      await linkEventTicket(getCurrentSupabaseClient(), groupId, doc.id, eventId);
      setReload((v) => v + 1);
    } catch {
      toast.error('Could not link the document.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: Document) => {
    haptics.remove();
    if (!eventId) {
      onPendingChange(pending.filter((d) => d.id !== doc.id));
      return;
    }
    // Unlinks only: the file stays in Documents.
    setLinked((prev) => prev.filter((d) => d.id !== doc.id));
    await unlinkDocument(getCurrentSupabaseClient(), { document_id: doc.id, entity_type: 'event', entity_id: eventId }).catch(() =>
      setReload((v) => v + 1)
    );
  };

  return (
    <FieldRow label="Tickets" hint={`New files are kept in ${EVENT_TICKETS_FOLDER_NAME} in Documents.`}>
      {shown.map((doc) => (
        <View key={doc.id} className="min-h-11 flex-row items-center gap-2">
          <Pressable
            className="min-w-0 flex-1 flex-row items-center gap-2"
            accessibilityRole="button"
            accessibilityLabel={`Open ${doc.title || doc.filename}`}
            onPress={() => void openDocumentExternally(getCurrentSupabaseClient(), doc.storage_path, documentBucket(doc.source))}
          >
            <FileText size={16} className="text-muted-foreground" />
            <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
              {doc.title || doc.filename}
            </Text>
          </Pressable>
          <Pressable onPress={() => void remove(doc)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove from this event">
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        </View>
      ))}
      <View className="flex-row items-center gap-2">
        <SearchablePicker
          options={options}
          value={null}
          onChange={(id) => void pickExisting(id)}
          placeholder="From Documents"
          searchPlaceholder="Search documents"
          emptyText="No documents yet"
          ariaLabel="Choose a document"
          disabled={busy}
          className="flex-1"
        />
        <Button variant="outline" size="sm" disabled={busy} onPress={() => void addFile()}>
          {busy ? <ActivityIndicator size="small" className="mr-1" /> : <Plus size={14} className="mr-1 text-foreground" />}
          Add file
        </Button>
      </View>
    </FieldRow>
  );
}
