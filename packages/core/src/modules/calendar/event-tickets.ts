// Event tickets in Documents (household feedback: "if scanning from a ticket,
// it should save the ticket to docs, in a default event tickets folder that
// gets created if it doesn't exist"). A ticket scanned or added from an event
// is uploaded into a top-level "Event tickets" folder and linked to the event
// (document_links, entity_type 'event'), so it shows on the event and in Docs.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Document, DocumentFolder, GroupEvent } from '../../types';
import { createDocumentFolder, listDocumentFolders } from '../documents/document-folders';
import { linkDocument, uploadDocument, type DocumentUploadInput } from '../documents/documents';

export const EVENT_TICKETS_FOLDER_NAME = 'Event tickets';

/** The household's top-level "Event tickets" folder, matched by name, any case. */
export function findEventTicketsFolder(folders: readonly DocumentFolder[]): DocumentFolder | null {
  const wanted = EVENT_TICKETS_FOLDER_NAME.toLowerCase();
  return folders.find((f) => f.parent_id === null && f.name.trim().toLowerCase() === wanted) ?? null;
}

/**
 * The "Event tickets" folder's id, creating it the first time. Null when the
 * household's database has no folders yet (the ticket then files at the root).
 */
export async function ensureEventTicketsFolder(supabase: SupabaseClient, groupId: string): Promise<string | null> {
  const existing = findEventTicketsFolder(await listDocumentFolders(supabase, groupId));
  if (existing) return existing.id;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  try {
    const folder = await createDocumentFolder(supabase, { groupId, name: EVENT_TICKETS_FOLDER_NAME, parentId: null, createdBy: user.id });
    return folder.id;
  } catch (err) {
    // Someone else made it at the same moment: use theirs.
    const raced = findEventTicketsFolder(await listDocumentFolders(supabase, groupId));
    if (raced) return raced.id;
    throw err;
  }
}

/**
 * Save a ticket to Documents' "Event tickets" folder and, when the event
 * already exists, link it. A new event links it after saving (linkEventTicket).
 */
export async function saveEventTicket(args: {
  supabase: SupabaseClient;
  groupId: string;
  input: DocumentUploadInput;
  eventId?: string | null;
  title?: string;
}): Promise<Document> {
  const { supabase, groupId, input, eventId } = args;
  const folderId = await ensureEventTicketsFolder(supabase, groupId).catch(() => null);
  const doc = await uploadDocument({
    supabase,
    groupId,
    input,
    docType: 'other',
    source: 'other',
    title: args.title ?? input.filename,
    folderId,
  });
  if (eventId) await linkEventTicket(supabase, groupId, doc.id, eventId);
  return doc;
}

export function linkEventTicket(supabase: SupabaseClient, groupId: string, documentId: string, eventId: string) {
  return linkDocument({ supabase, documentId, groupId, entityType: 'event', entityId: eventId });
}

/**
 * The events a document can be added to from Documents: the viewer's
 * household events from today on (someone else's private ones left out),
 * soonest first.
 */
export function linkableEvents(events: readonly GroupEvent[], viewerId: string | null | undefined, now: Date = new Date()): GroupEvent[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return events
    .filter((e) => !e.deleted && (!e.private || e.created_by === viewerId))
    .filter((e) => new Date(e.ends_at ?? e.starts_at).getTime() >= startOfToday)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
