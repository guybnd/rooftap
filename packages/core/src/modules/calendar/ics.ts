// HOUP-67: only the pure ICS-string builder lives here. `downloadIcs` (the
// Web Share API / anchor-download trigger) is inherently browser-only
// (`navigator.share`, `document.createElement`) with no RN equivalent, so it
// stays in apps/web/src/lib/ics.ts as a thin wrapper around `generateIcs`.

function formatIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface IcsEvent {
  summary: string;
  dtstart: Date;
  location?: string;
  description?: string;
  durationMinutes?: number;
}

export function generateIcs(event: IcsEvent): string {
  const dtstart = formatIcsDate(event.dtstart);
  const dtend = formatIcsDate(
    new Date(event.dtstart.getTime() + (event.durationMinutes ?? 30) * 60000)
  );
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@homeup`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rooftap//Appointment//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
