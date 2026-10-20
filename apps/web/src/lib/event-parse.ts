import { normalizeParsedEvent, parseIcs, parsedEventFromIcs, type ParsedEventDetails } from "@homeup/core";

// Calendar: fill an event from a link or a ticket. Links, photos and PDFs go
// to /api/parse-event (AI); a calendar file (.ics) is read right here.

export type EventParseResult = { ok: true; details: ParsedEventDetails } | { ok: false; error: string };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function post(body: Record<string, unknown>): Promise<EventParseResult> {
  try {
    const res = await fetch("/api/parse-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

export function isCalendarFile(file: File): boolean {
  return file.type === "text/calendar" || /\.ics$/i.test(file.name);
}

export async function parseEventFile(file: File): Promise<EventParseResult> {
  if (isCalendarFile(file)) {
    const text = await file.text();
    const parsed = parseIcs(text);
    return parsed ? { ok: true, details: parsedEventFromIcs(parsed, text) } : { ok: false, error: "No event in that calendar file." };
  }
  const dataUrl = await fileToDataUrl(file);
  return post(file.type === "application/pdf" ? { pdf: dataUrl } : { images: [dataUrl] });
}

/** Read an event from a photo or PDF already in Documents ("Add to calendar" there). */
export function parseEventDocument(documentId: string): Promise<EventParseResult> {
  return post({ documentId });
}
