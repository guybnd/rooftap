export interface ParsedEvent {
  summary: string;
  dtstart: Date | null;
  dtend: Date | null;
  location: string;
  description: string;
}

function unescapeIcsText(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDate(value: string): Date | null {
  const clean = value.replace(/^.*:/, "");
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) {
    const dateOnly = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnly) {
      return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
    }
    return null;
  }
  const isUtc = clean.endsWith("Z");
  if (isUtc) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  }
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function unfoldLines(raw: string): string[] {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function parseIcs(content: string): ParsedEvent | null {
  const lines = unfoldLines(content);

  let inEvent = false;
  let summary = "";
  let dtstart: Date | null = null;
  let dtend: Date | null = null;
  let location = "";
  let description = "";

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      continue;
    }
    if (upper === "END:VEVENT") break;
    if (!inEvent) continue;

    if (upper.startsWith("SUMMARY")) {
      summary = unescapeIcsText(line.replace(/^SUMMARY[^:]*:/, ""));
    } else if (upper.startsWith("DTSTART")) {
      dtstart = parseIcsDate(line.replace(/^DTSTART[^:]*:/, ""));
    } else if (upper.startsWith("DTEND")) {
      dtend = parseIcsDate(line.replace(/^DTEND[^:]*:/, ""));
    } else if (upper.startsWith("LOCATION")) {
      location = unescapeIcsText(line.replace(/^LOCATION[^:]*:/, ""));
    } else if (upper.startsWith("DESCRIPTION")) {
      description = unescapeIcsText(line.replace(/^DESCRIPTION[^:]*:/, ""));
    }
  }

  if (!inEvent) return null;
  return { summary, dtstart, dtend, location, description };
}
