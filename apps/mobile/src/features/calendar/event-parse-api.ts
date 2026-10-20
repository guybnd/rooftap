// Calendar: fill an event from a link or a ticket, the native side of
// apps/web/src/lib/event-parse.ts. Links, photos and PDFs go to
// POST /api/parse-event (AI) with the session's Bearer token, the same
// authedFetch pattern as calendar-api.ts; a calendar file (.ics) is read on
// the device with core's parseIcs.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { normalizeParsedEvent, parseIcs, parsedEventFromIcs, type DocumentUploadInput, type ParsedEventDetails } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export type EventParseResult = { ok: true; details: ParsedEventDetails } | { ok: false; error: string };

async function post(body: Record<string, unknown>): Promise<EventParseResult> {
  try {
    const server = await getStoredServer();
    if (!server) return { ok: false, error: 'No server configured.' };
    const {
      data: { session },
    } = await getCurrentSupabaseClient().auth.getSession();
    const res = await fetch(`${server.origin}/api/parse-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? "Couldn't read that. Try again." };
    return { ok: true, details: normalizeParsedEvent(data) };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

export function parseEventLink(url: string): Promise<EventParseResult> {
  return post({ url: url.trim() });
}

function isCalendarFile(name: string, mimeType: string | null | undefined): boolean {
  return mimeType === 'text/calendar' || /\.ics$/i.test(name);
}

export interface ParsedTicket {
  result: EventParseResult;
  /** The ticket itself, for keeping in Documents; null for a calendar file (nothing worth keeping). */
  file: DocumentUploadInput | null;
}

/** Pick a ticket (photo, screenshot, PDF or calendar file) and read it. Null when the picker was cancelled. */
export async function pickAndParseTicket(): Promise<ParsedTicket | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf', 'text/calendar', 'application/ics', 'text/x-vcalendar'],
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return null;

  if (isCalendarFile(asset.name, asset.mimeType)) {
    const text = await FileSystem.readAsStringAsync(asset.uri);
    const parsed = parseIcs(text);
    return {
      result: parsed ? { ok: true, details: parsedEventFromIcs(parsed, text) } : { ok: false, error: 'No event in that calendar file.' },
      file: null,
    };
  }

  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64}`;
  return {
    result: await post(mimeType === 'application/pdf' ? { pdf: dataUrl } : { images: [dataUrl] }),
    file: uploadInput(asset.name, mimeType, base64),
  };
}

function uploadInput(filename: string, mimeType: string, base64: string): DocumentUploadInput {
  const body = decode(base64);
  return { body, filename, mimeType, sizeBytes: body.byteLength };
}

/** Pick a ticket (photo, screenshot or PDF) just to keep with an event. Null when cancelled. */
export async function pickTicketFile(): Promise<DocumentUploadInput | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return null;
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  return uploadInput(asset.name, asset.mimeType ?? 'image/jpeg', base64);
}

/** Read an event from a photo or PDF already in Documents ("Add to calendar" there). */
export function parseEventDocument(documentId: string): Promise<EventParseResult> {
  return post({ documentId });
}
