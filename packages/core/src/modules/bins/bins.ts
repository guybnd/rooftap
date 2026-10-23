// Bin night module: which bins go out on which night. The schedule is a list
// of bin streams (a lid colour, a weekday, every N weeks from an anchor date)
// plus the council's one-off changes (a collection moved or skipped, usually
// around public holidays). The plan row holds the reminder time, whose turn it
// is, and whether the next collection's bins are out.
//
// Everything here is pure, so web, mobile and the notify-bin-night edge
// function (a Deno twin, supabase/functions/_shared/bin-schedule.ts, checked
// against this file by bins.test.ts) work out the same nights.
import { addDaysISO, daysBetweenISO, toISODate } from '../../date-utils';
import type { HeroItem } from '../../hero';

export type BinLid = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'grey' | 'other';
export type BinSource = 'manual' | 'council' | 'home-assistant';

/**
 * Lid colours are content, not chrome (spec): they only ever paint the small
 * lid marks, never text, tiles or buttons. The same hex on every theme, like
 * the real bins.
 */
export const BIN_LIDS: readonly { id: BinLid; label: string; color: string }[] = [
  { id: 'red', label: 'Red', color: '#D8342C' },
  { id: 'yellow', label: 'Yellow', color: '#F2C230' },
  { id: 'green', label: 'Green', color: '#3E9B47' },
  { id: 'blue', label: 'Blue', color: '#2F6FD0' },
  { id: 'purple', label: 'Purple', color: '#7A4BB8' },
  { id: 'grey', label: 'Grey', color: '#5F646B' },
  { id: 'other', label: 'Other', color: '#A39C93' },
];

export function isBinLid(value: unknown): value is BinLid {
  return typeof value === 'string' && BIN_LIDS.some((l) => l.id === value);
}

export function binLidColor(lid: BinLid): string {
  return (BIN_LIDS.find((l) => l.id === lid) ?? BIN_LIDS[BIN_LIDS.length - 1]).color;
}

export interface BinStream {
  id: string;
  group_id: string;
  /** What the household calls it: "Red", "Recycling", "Glass". */
  name: string;
  lid: BinLid;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** 1 = every week, 2 = every second week, up to 8. */
  every_weeks: number;
  /** One collection date on the pattern; the others are every_weeks apart from it. */
  anchor_date: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface BinChange {
  id: string;
  group_id: string;
  /** The stream it changes; null for every bin due that day. */
  stream_id: string | null;
  /** The date the collection was due (or, for an extra collection, its date). */
  on_date: string;
  /** Where it moved to; null when there is no collection. */
  moved_to: string | null;
  note: string | null;
  source: BinSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface BinPlan {
  id: string;
  group_id: string;
  /** "HH:MM" on the night before: when the Home card shows. */
  remind_at: string;
  /** "HH:MM" on the night before: the push if they're not out yet; null for none. */
  push_at: string | null;
  /** Member ids who take turns, in order. Empty: nobody's turn. */
  rotation: string[];
  /** A date in the week that is rotation[0]'s turn. */
  rotation_anchor: string | null;
  /** The collection date whose bins are out. */
  out_for: string | null;
  out_by: string | null;
  /** IANA zone of whoever saved it last, so the push goes at their 9 pm. */
  timezone: string | null;
  setup_source: BinSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export const DEFAULT_BIN_REMIND_AT = '19:00';
export const DEFAULT_BIN_PUSH_AT = '21:00';

/** How far ahead a schedule is read for the next collection. */
const NEXT_HORIZON_DAYS = 70;
/** A moved collection can land up to this many days from its due date. */
const MOVE_REACH_DAYS = 14;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const BIN_WEEKDAY_LABELS: readonly string[] = WEEKDAYS;

/** The weekday of a YYYY-MM-DD date, 0 = Sunday. Calendar arithmetic only, no time zone. */
export function weekdayOfISO(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Whether a stream's regular pattern collects on a date (changes aside). */
export function streamCollectsOn(stream: Pick<BinStream, 'weekday' | 'every_weeks' | 'anchor_date'>, dateISO: string): boolean {
  if (weekdayOfISO(dateISO) !== stream.weekday) return false;
  const every = Math.max(1, Math.round(stream.every_weeks || 1));
  if (every === 1) return true;
  const weeks = Math.floor(daysBetweenISO(stream.anchor_date, dateISO) / 7);
  return mod(weeks, every) === 0;
}

/** One collection day: the bins collected that date. */
export interface BinCollection {
  date: string;
  streams: BinStream[];
  /** Streams whose collection moved here, with the date they were due. */
  moved: { streamId: string; from: string }[];
  /** Notes from the changes that touch this day. */
  notes: string[];
}

function liveStreams(streams: readonly BinStream[]): BinStream[] {
  return streams
    .filter((s) => !s.deleted)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/**
 * Every collection from `fromISO` to `toISO` (both inclusive), in date order,
 * with the changes applied: a change for a stream (or for every stream, when
 * its stream_id is null) on a date it was due moves it to `moved_to`, or drops
 * it when that is null. A change for a stream on a date it wasn't due adds an
 * extra collection on `moved_to`.
 */
export function binCollections(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  fromISO: string,
  toISO: string,
): BinCollection[] {
  const live = liveStreams(streams);
  const liveChanges = changes.filter((c) => !c.deleted);
  const byId = new Map(live.map((s) => [s.id, s]));
  const byDate = new Map<string, BinCollection>();
  const used = new Set<string>();

  const add = (date: string, stream: BinStream, movedFrom: string | null, note: string | null) => {
    if (date < fromISO || date > toISO) return;
    let day = byDate.get(date);
    if (!day) {
      day = { date, streams: [], moved: [], notes: [] };
      byDate.set(date, day);
    }
    if (!day.streams.some((s) => s.id === stream.id)) day.streams.push(stream);
    if (movedFrom && movedFrom !== date) day.moved.push({ streamId: stream.id, from: movedFrom });
    if (note && !day.notes.includes(note)) day.notes.push(note);
  };

  const start = addDaysISO(fromISO, -MOVE_REACH_DAYS);
  const span = daysBetweenISO(start, toISO) + MOVE_REACH_DAYS;
  for (let i = 0; i <= span; i++) {
    const date = addDaysISO(start, i);
    for (const stream of live) {
      if (!streamCollectsOn(stream, date)) continue;
      const change =
        liveChanges.find((c) => c.on_date === date && c.stream_id === stream.id) ??
        liveChanges.find((c) => c.on_date === date && c.stream_id === null);
      if (change) {
        used.add(change.id);
        if (change.moved_to) add(change.moved_to, stream, date, change.note);
        continue;
      }
      add(date, stream, null, null);
    }
  }

  // Extra collections: a change for a stream on a day it isn't due.
  for (const change of liveChanges) {
    if (used.has(change.id) || !change.moved_to || !change.stream_id) continue;
    const stream = byId.get(change.stream_id);
    if (!stream || streamCollectsOn(stream, change.on_date)) continue;
    add(change.moved_to, stream, null, change.note);
  }

  for (const day of byDate.values()) day.streams.sort((a, b) => live.indexOf(a) - live.indexOf(b));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The first collection on or after `fromISO`, or null when none is set up. */
export function nextBinCollection(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  fromISO: string,
): BinCollection | null {
  return binCollections(streams, changes, fromISO, addDaysISO(fromISO, NEXT_HORIZON_DAYS))[0] ?? null;
}

/** The next `count` collections from `fromISO`. */
export function upcomingBinCollections(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  fromISO: string,
  count: number,
): BinCollection[] {
  return binCollections(streams, changes, fromISO, addDaysISO(fromISO, NEXT_HORIZON_DAYS)).slice(0, count);
}

/** Whose turn a collection is: rotation members take a week each from rotation_anchor. */
export function binTurn(plan: Pick<BinPlan, 'rotation' | 'rotation_anchor'> | null | undefined, dateISO: string): string | null {
  const rotation = plan?.rotation ?? [];
  if (rotation.length === 0) return null;
  if (rotation.length === 1 || !plan?.rotation_anchor) return rotation[0];
  const weeks = Math.floor(daysBetweenISO(plan.rotation_anchor, dateISO) / 7);
  return rotation[mod(weeks, rotation.length)];
}

/** Where bin night stands right now. */
export interface BinNightState {
  /** The next collection (today's counts until the day is over). */
  collection: BinCollection | null;
  /** The evening the bins go out: the day before the collection. */
  nightOf: string | null;
  /** Tonight is bin night. */
  tonight: boolean;
  /** The next collection's bins are marked out. */
  out: boolean;
  /** Whose turn the next collection is (a member id). */
  turn: string | null;
}

export function binNightState(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  plan: BinPlan | null | undefined,
  todayISO: string,
): BinNightState {
  const collection = nextBinCollection(streams, changes, todayISO);
  if (!collection) return { collection: null, nightOf: null, tonight: false, out: false, turn: null };
  const nightOf = addDaysISO(collection.date, -1);
  return {
    collection,
    nightOf,
    tonight: nightOf === todayISO,
    out: !!plan?.out_for && plan.out_for === collection.date,
    turn: binTurn(plan, collection.date),
  };
}

/**
 * Whether Home's card shows: on bin night from the reminder time, until the
 * bins are out. `nowHHMM` is the local wall clock.
 */
export function binNightDue(state: BinNightState, plan: BinPlan | null | undefined, nowHHMM: string): boolean {
  if (!state.tonight || state.out) return false;
  return nowHHMM >= (plan?.remind_at || DEFAULT_BIN_REMIND_AT);
}

/**
 * Bin night on Home's feed and Now card: one item on bin night, timed at the
 * reminder, done once the bins are out (it lingers as done, like a finished
 * task). Null on any other day.
 */
export function binNightHeroItem(state: BinNightState, plan: BinPlan | null | undefined, todayISO: string): HeroItem | null {
  if (!state.tonight || !state.collection) return null;
  const { collection } = state;
  return {
    id: `bins-${collection.date}`,
    type: 'bins',
    ownerSection: 'bins',
    title: 'Bins out tonight',
    dueDate: todayISO,
    dueTime: plan?.remind_at || DEFAULT_BIN_REMIND_AT,
    overdue: false,
    done: state.out,
    assignedTo: state.turn,
    sourceLabel: binNamesPhrase(collection.streams),
    binNight: { collectionDate: collection.date, lids: collection.streams.map((s) => s.lid) },
  };
}

// ── Copy ────────────────────────────────────────────────────────────────────

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "Red and yellow", "Red, yellow and green": the bins in a collection. */
export function binNamesPhrase(streams: readonly Pick<BinStream, 'name'>[]): string {
  const names = streams.map((s, i) => (i === 0 ? s.name.trim() : s.name.trim().toLowerCase())).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return capitalize(names[0]);
  return capitalize(`${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
}

/** "Every Wednesday", "Every second Wednesday", "Every 4 weeks on Wednesday". */
export function binCadenceLabel(stream: Pick<BinStream, 'weekday' | 'every_weeks'>): string {
  const day = WEEKDAYS[stream.weekday] ?? 'week';
  if (stream.every_weeks <= 1) return `Every ${day}`;
  if (stream.every_weeks === 2) return `Every second ${day}`;
  return `Every ${stream.every_weeks} weeks on ${day}`;
}

/** A collection day relative to today: "Today", "Tomorrow", "Wednesday", "Tue 4 Nov". */
export function binDayLabel(dateISO: string, todayISO: string): string {
  const days = daysBetweenISO(todayISO, dateISO);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (days > 1 && days < 7) return date.toLocaleDateString('en-AU', { weekday: 'long' });
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Wed 24 Dec", for a change row. */
export function binShortDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** One line for a change: "Moves to Sat 27 Dec" or "No collection". */
export function binChangeLabel(change: Pick<BinChange, 'moved_to' | 'on_date'>): string {
  if (!change.moved_to) return 'No collection';
  if (change.moved_to === change.on_date) return 'Extra collection';
  return `Moves to ${binShortDate(change.moved_to)}`;
}

/** The days of a strip from `fromISO`: `weeks` rows of seven dates. */
export function binStripWeeks(fromISO: string, weeks = 2): string[][] {
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysISO(fromISO, w * 7 + d)));
}

// ── Building a schedule ─────────────────────────────────────────────────────

/** A stream as the setup sheet edits it; `id` is set for one already saved. */
export interface BinStreamDraft {
  key: string;
  id?: string;
  name: string;
  lid: BinLid;
  weekday: number;
  every_weeks: number;
  /** The next collection on the pattern. */
  anchor_date: string;
}

/** A change as the setup sheet edits it; `streamKey` null means every bin. */
export interface BinChangeDraft {
  key: string;
  id?: string;
  streamKey: string | null;
  on_date: string;
  moved_to: string | null;
  note: string | null;
}

/** The date of the next `weekday` on or after `fromISO`, plus `weeksLater` weeks. */
export function nextWeekdayISO(fromISO: string, weekday: number, weeksLater = 0): string {
  const shift = mod(weekday - weekdayOfISO(fromISO), 7);
  return addDaysISO(fromISO, shift + weeksLater * 7);
}

/** Moves a draft's anchor onto its weekday (the next one from `fromISO`), keeping which week it was in. */
export function realignBinAnchor(draft: BinStreamDraft, fromISO: string): BinStreamDraft {
  if (weekdayOfISO(draft.anchor_date) === draft.weekday) return draft;
  const weeksOut = Math.max(0, Math.floor(daysBetweenISO(fromISO, draft.anchor_date) / 7));
  return { ...draft, anchor_date: nextWeekdayISO(fromISO, draft.weekday, weeksOut) };
}

/** Which week of its cycle a draft's next collection falls in, from `fromISO`: 0 = this week. */
export function binDraftWeekOffset(draft: Pick<BinStreamDraft, 'weekday' | 'every_weeks' | 'anchor_date'>, fromISO: string): number {
  for (let w = 0; w < Math.max(1, draft.every_weeks); w++) {
    if (streamCollectsOn(draft, nextWeekdayISO(fromISO, draft.weekday, w))) return w;
  }
  return 0;
}

/** A first guess at a lid colour from a bin's name. */
export function guessBinLid(name: string): BinLid {
  const n = name.toLowerCase();
  for (const lid of BIN_LIDS) if (lid.id !== 'other' && n.includes(lid.id)) return lid.id;
  if (/black|charcoal/.test(n)) return 'grey';
  if (/recycl|mixed/.test(n)) return 'yellow';
  if (/garden|green|organic|fogo|food/.test(n)) return 'green';
  if (/glass/.test(n)) return 'purple';
  if (/paper|cardboard/.test(n)) return 'blue';
  if (/general|rubbish|waste|landfill|garbage|trash/.test(n)) return 'red';
  return 'other';
}

/** A new stream for the setup sheet: every week, on `weekday` (tomorrow's by default), from its next date. */
export function newBinStreamDraft(key: string, todayISO: string, lid: BinLid = 'red', weekday?: number): BinStreamDraft {
  const day = weekday ?? weekdayOfISO(addDaysISO(todayISO, 1));
  const label = (BIN_LIDS.find((l) => l.id === lid) ?? BIN_LIDS[0]).label;
  return { key, name: label, lid, weekday: day, every_weeks: 1, anchor_date: nextWeekdayISO(todayISO, day) };
}

/** Drafts for what's saved, to edit. */
export function binDraftsFrom(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  todayISO: string,
): { streams: BinStreamDraft[]; changes: BinChangeDraft[] } {
  const live = liveStreams(streams);
  return {
    streams: live.map((s) => {
      // Re-anchor on the next collection, so the editor's "this week / next week" reads right.
      const next = nextWeekdayISO(todayISO, s.weekday, binDraftWeekOffset(s, todayISO));
      return { key: s.id, id: s.id, name: s.name, lid: s.lid, weekday: s.weekday, every_weeks: s.every_weeks, anchor_date: next };
    }),
    changes: changes
      .filter((c) => !c.deleted && (c.moved_to ?? c.on_date) >= addDaysISO(todayISO, -1))
      .filter((c) => c.stream_id === null || live.some((s) => s.id === c.stream_id))
      .sort((a, b) => a.on_date.localeCompare(b.on_date))
      .map((c) => ({ key: c.id, id: c.id, streamKey: c.stream_id, on_date: c.on_date, moved_to: c.moved_to, note: c.note })),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function weekdayFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  if (typeof value === 'string') {
    const i = WEEKDAYS.findIndex((d) => d.toLowerCase().startsWith(value.trim().toLowerCase().slice(0, 3)));
    if (i >= 0 && value.trim().length >= 3) return i;
  }
  return null;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/\bbins?\b/g, '').replace(/[^a-z0-9]/g, '');
}

/** The draft a free-text bin name points at, by name or lid colour. */
function matchStreamKey(name: unknown, drafts: readonly BinStreamDraft[]): string | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const key = nameKey(name);
  if (!key || /^(all|every|allbins|everything)$/.test(key)) return null;
  const exact = drafts.find((d) => nameKey(d.name) === key);
  if (exact) return exact.key;
  const loose = drafts.find((d) => nameKey(d.name).includes(key) || key.includes(nameKey(d.name)));
  if (loose) return loose.key;
  const lid = guessBinLid(name);
  return drafts.find((d) => d.lid === lid)?.key ?? null;
}

/** What an AI read of a council calendar (or anything else) gives, before review. */
export interface ParsedBinSetup {
  streams: BinStreamDraft[];
  changes: BinChangeDraft[];
}

/**
 * Normalizes the AI read of a council calendar into drafts for the person to
 * confirm: streams with a valid weekday, interval and a next date on that
 * weekday (from `todayISO`), and changes that name a known stream or every
 * bin. Anything it can't make sense of is dropped, never guessed.
 */
export function normalizeParsedBins(raw: unknown, todayISO: string): ParsedBinSetup {
  const input = (raw && typeof raw === 'object' ? raw : {}) as { streams?: unknown; changes?: unknown };
  const streams: BinStreamDraft[] = [];
  for (const [i, entry] of (Array.isArray(input.streams) ? input.streams : []).entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 40) : '';
    const next = isISODate(s.next_date) ? s.next_date : null;
    const weekday = weekdayFrom(s.weekday) ?? (next ? weekdayOfISO(next) : null);
    if (!name || weekday === null) continue;
    const every = typeof s.every_weeks === 'number' && s.every_weeks >= 1 && s.every_weeks <= 8 ? Math.round(s.every_weeks) : 1;
    const lid = isBinLid(s.lid) ? s.lid : guessBinLid(name);
    // The next date the calendar gives fixes which week it's on; move it onto its weekday and forward to today.
    let anchor = next && weekdayOfISO(next) === weekday ? next : nextWeekdayISO(next ?? todayISO, weekday);
    while (anchor < todayISO) anchor = addDaysISO(anchor, every * 7);
    streams.push({ key: `s${i}`, name, lid, weekday, every_weeks: every, anchor_date: anchor });
  }
  const changes: BinChangeDraft[] = [];
  for (const [i, entry] of (Array.isArray(input.changes) ? input.changes : []).entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    if (!isISODate(c.date)) continue;
    const moved = c.moved_to === null || c.moved_to === undefined ? null : isISODate(c.moved_to) ? c.moved_to : undefined;
    if (moved === undefined) continue;
    if ((moved ?? c.date) < addDaysISO(todayISO, -1)) continue;
    const note = typeof c.note === 'string' && c.note.trim() ? c.note.trim().slice(0, 80) : null;
    changes.push({ key: `c${i}`, streamKey: matchStreamKey(c.bin, streams), on_date: c.date, moved_to: moved, note });
  }
  return { streams, changes };
}

/**
 * Works a schedule out from a list of collection dates (Home Assistant's
 * Waste Collection Schedule calendar): per bin, the usual weekday and gap,
 * and changes for the dates off the pattern. A due date with a collection a
 * few days either side becomes a move; one with none, a skip; a collection
 * on no due date nearby, an extra one.
 */
export function inferBinSetup(collections: readonly { date: string; name: string }[], todayISO: string): ParsedBinSetup {
  const groups = new Map<string, { name: string; dates: string[] }>();
  for (const c of collections) {
    if (!isISODate(c.date) || !c.name?.trim()) continue;
    const key = nameKey(c.name) || c.name.trim().toLowerCase();
    const group = groups.get(key) ?? { name: c.name.trim().slice(0, 40), dates: [] };
    if (!group.dates.includes(c.date)) group.dates.push(c.date);
    groups.set(key, group);
  }

  const streams: BinStreamDraft[] = [];
  const changes: BinChangeDraft[] = [];
  let i = 0;
  for (const { name, dates } of groups.values()) {
    dates.sort();
    const key = `s${i++}`;
    const weekday = mostCommon(dates.map(weekdayOfISO)) ?? weekdayOfISO(dates[0]);
    const onDay = dates.filter((d) => weekdayOfISO(d) === weekday);
    const gaps = onDay.slice(1).map((d, j) => Math.round(daysBetweenISO(onDay[j], d) / 7)).filter((g) => g >= 1 && g <= 8);
    const every = smallestCommonGap(gaps);
    const first = onDay[0] ?? nextWeekdayISO(dates[0], weekday);
    const stream = { weekday, every_weeks: every, anchor_date: first };

    // Due dates across the span the list covers, against the dates it gives.
    const last = dates[dates.length - 1];
    const actual = new Set(dates);
    const consumed = new Set<string>();
    for (let d = first; d <= last; d = addDaysISO(d, every * 7)) {
      if (actual.has(d)) {
        consumed.add(d);
        continue;
      }
      const near = dates.find((a) => !consumed.has(a) && !streamCollectsOn(stream, a) && Math.abs(daysBetweenISO(d, a)) <= 6);
      if (near) consumed.add(near);
      changes.push({ key: `c${changes.length}`, streamKey: key, on_date: d, moved_to: near ?? null, note: null });
    }
    for (const a of dates) {
      if (!consumed.has(a)) changes.push({ key: `c${changes.length}`, streamKey: key, on_date: a, moved_to: a, note: null });
    }

    let anchor = first;
    while (anchor < todayISO) anchor = addDaysISO(anchor, every * 7);
    streams.push({ key, name, lid: guessBinLid(name), weekday, every_weeks: every, anchor_date: anchor });
  }
  return {
    streams,
    changes: changes.filter((c) => (c.moved_to ?? c.on_date) >= addDaysISO(todayISO, -1)).sort((a, b) => a.on_date.localeCompare(b.on_date)),
  };
}

function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && v < best)) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/** The usual gap in weeks: the most common one, so a holiday shift doesn't double it. */
function smallestCommonGap(gaps: number[]): number {
  return mostCommon(gaps) ?? 1;
}

/** The local wall clock as "HH:MM". */
export function binClock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Today's local date, for callers that hold a Date. */
export function binTodayOf(now: Date): string {
  return toISODate(now);
}
