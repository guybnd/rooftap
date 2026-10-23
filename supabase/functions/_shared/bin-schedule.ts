// Bin night: the Deno twin of packages/core's modules/bins/bins.ts, for the
// notify-bin-night function. Deno can't resolve the core package graph, so
// the schedule rules are restated here, pure and import-free;
// packages/core/src/modules/bins/bins.test.ts imports this file and checks it
// against core over every day of a few schedules, so the two can't drift.

export interface TwinStream {
  id: string;
  name: string;
  weekday: number;
  every_weeks: number;
  anchor_date: string;
  sort_order: number;
}

export interface TwinChange {
  stream_id: string | null;
  on_date: string;
  moved_to: string | null;
}

function dayNumber(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Add days to a YYYY-MM-DD date. */
export function addDaysISO(dateISO: string, days: number): string {
  return new Date((dayNumber(dateISO) + days) * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(dateISO: string): number {
  return new Date(dayNumber(dateISO) * 86_400_000).getUTCDay();
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function collectsOn(stream: TwinStream, dateISO: string): boolean {
  if (weekdayOf(dateISO) !== stream.weekday) return false;
  const every = Math.max(1, Math.round(stream.every_weeks || 1));
  if (every === 1) return true;
  return mod(Math.floor((dayNumber(dateISO) - dayNumber(stream.anchor_date)) / 7), every) === 0;
}

function changeFor(changes: readonly TwinChange[], stream: TwinStream, dateISO: string): TwinChange | undefined {
  return (
    changes.find((c) => c.on_date === dateISO && c.stream_id === stream.id) ??
    changes.find((c) => c.on_date === dateISO && c.stream_id === null)
  );
}

/** The streams collected on a date, with the changes applied, in their sort order. */
export function binsCollectedOn(streams: readonly TwinStream[], changes: readonly TwinChange[], dateISO: string): TwinStream[] {
  const on = new Set<string>();
  for (const stream of streams) {
    if (collectsOn(stream, dateISO) && !changeFor(changes, stream, dateISO)) on.add(stream.id);
  }
  for (const change of changes) {
    if (change.moved_to !== dateISO) continue;
    for (const stream of streams) {
      if (change.stream_id !== null && change.stream_id !== stream.id) continue;
      if (collectsOn(stream, change.on_date)) {
        // Due that day: moved here, unless a change of its own wins on that day.
        if (changeFor(changes, stream, change.on_date) === change) on.add(stream.id);
      } else if (change.stream_id === stream.id) {
        // Not due that day: an extra collection.
        on.add(stream.id);
      }
    }
  }
  return streams
    .filter((s) => on.has(s.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** "Red and yellow". */
export function binNamesPhrase(streams: readonly { name: string }[]): string {
  const names = streams.map((s, i) => (i === 0 ? s.name.trim() : s.name.trim().toLowerCase())).filter(Boolean);
  if (names.length === 0) return "";
  const text = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return text[0].toUpperCase() + text.slice(1);
}

/** Whose turn a collection is: rotation members take a week each from the anchor. */
export function binTurn(rotation: readonly string[], anchor: string | null, dateISO: string): string | null {
  if (rotation.length === 0) return null;
  if (rotation.length === 1 || !anchor) return rotation[0];
  return rotation[mod(Math.floor((dayNumber(dateISO) - dayNumber(anchor)) / 7), rotation.length)];
}

/** The wall-clock date and "HH:MM" at an instant in a time zone. */
export function localDateTime(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
