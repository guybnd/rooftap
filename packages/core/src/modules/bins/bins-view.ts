// Bin night: the screen and setup-sheet helpers both apps share. The apps
// keep their own rendering, toasts, file pickers and how they name people
// (each passes its own `nameOf`).

import { addDaysISO } from '../../date-utils';
import {
  binChangeLabel,
  binCollections,
  binDayLabel,
  binNamesPhrase,
  binShortDate,
  binStripWeeks,
  inferBinSetup,
  normalizeParsedBins,
  type BinChange,
  type BinChangeDraft,
  type BinCollection,
  type BinLid,
  type BinNightState,
  type BinStream,
  type BinStreamDraft,
  type ParsedBinSetup,
} from './bins';

/** Short day names for the two-week strip and the collection rows. */
export const BIN_DAY_LETTERS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The lid colours a new bin takes, in order, skipping ones already used. */
export const BIN_NEW_LID_ORDER: readonly BinLid[] = ['yellow', 'green', 'blue', 'purple', 'red', 'grey'];

/** The first lid colour no bin uses yet, else 'other'. */
export function nextFreeBinLid(streams: readonly Pick<BinStreamDraft, 'lid'>[]): BinLid {
  const used = new Set(streams.map((s) => s.lid));
  return BIN_NEW_LID_ORDER.find((l) => !used.has(l)) ?? 'other';
}

/** "your turn", "Sam's turn", or null with no rotation. */
export function binTurnCaption(id: string | null, currentUserId: string | null | undefined, nameOf: (id: string) => string): string | null {
  if (!id) return null;
  return id === currentUserId ? 'your turn' : `${nameOf(id)}'s turn`;
}

/** The Hero (H1): the next collection day and what goes out, or the empty prompt. */
export function binsLede(
  night: BinNightState,
  today: string,
  turnCaption: (id: string | null) => string | null,
): { value: string; caption: string } {
  const collection = night.collection;
  if (!collection) return { value: 'No bins', caption: 'Add your bin days to get a reminder the night before' };
  return {
    value: binDayLabel(collection.date, today),
    caption: [
      night.tonight ? `Out tonight: ${binNamesPhrase(collection.streams).toLowerCase()}` : binNamesPhrase(collection.streams),
      turnCaption(night.turn),
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** The next two weeks, Sunday first, each day with its collection or null. */
export function binStripDays(
  streams: readonly BinStream[],
  changes: readonly BinChange[],
  today: string,
): { date: string; collection: BinCollection | null }[][] {
  const weeks = binStripWeeks(today, 2);
  const byDate = new Map(binCollections(streams, changes, today, weeks[1][6]).map((c) => [c.date, c]));
  return weeks.map((week) => week.map((date) => ({ date, collection: byDate.get(date) ?? null })));
}

/** Changes that still matter (the day, or the day it moved to, is today or later), soonest first. */
export function comingBinChanges(changes: readonly BinChange[], today: string): BinChange[] {
  return changes.filter((c) => (c.moved_to ?? c.on_date) >= today).sort((a, b) => a.on_date.localeCompare(b.on_date));
}

/** A change row's title: its date and which bin. */
export function binChangeTitle(change: Pick<BinChange, 'on_date' | 'stream_id'>, streamName: ReadonlyMap<string, string>): string {
  return `${binShortDate(change.on_date)} · ${change.stream_id ? streamName.get(change.stream_id) ?? 'Bin' : 'Every bin'}`;
}

/** A change row's meta: what happens, and the council's note. */
export function binChangeMeta(change: Pick<BinChange, 'moved_to' | 'on_date' | 'note'>): string {
  return [binChangeLabel(change), change.note].filter(Boolean).join(' · ');
}

/** A coming collection row's meta: whose turn, where it moved from, and the first note. */
export function binCollectionMeta(collection: BinCollection, turn: string | null, turnLabel: (id: string) => string): string {
  const movedFrom = collection.moved[0]?.from ?? null;
  return [turn ? turnLabel(turn) : null, movedFrom ? `moved from ${binShortDate(movedFrom)}` : null, collection.notes[0] ?? null]
    .filter(Boolean)
    .join(' · ');
}

/** When a coming collection goes out: "Tonight" on bin night, else its day. */
export function binCollectionWhen(collectionDate: string, today: string): string {
  return addDaysISO(collectionDate, -1) === today ? 'Tonight' : binDayLabel(collectionDate, today);
}

/** The setup sheet's change line after the date and bin: "extra", "to Tue 4 Nov" or "none", then the note. */
export function binChangeDraftDetail(change: Pick<BinChangeDraft, 'moved_to' | 'on_date' | 'note'>): string {
  const what = change.moved_to ? (change.moved_to === change.on_date ? 'extra' : `to ${binShortDate(change.moved_to)}`) : 'none';
  return `${what}${change.note ? ` · ${change.note}` : ''}`;
}

/** What the setup sheet says after a read fills it in. */
export function binReadNote(setup: Pick<ParsedBinSetup, 'changes'>, streamCount: number): string {
  const n = streamCount;
  const m = setup.changes.length;
  return `Found ${n} ${n === 1 ? 'bin' : 'bins'}${m ? ` and ${m} ${m === 1 ? 'change' : 'changes'}` : ''}. Check them below, then save.`;
}

export type BinSetupResult = { ok: true; setup: ParsedBinSetup } | { ok: false; error: string };

export interface HomeAssistantBinCalendar {
  entityId: string;
  name: string;
}

export type HomeAssistantBinsResult =
  | { ok: true; setup: ParsedBinSetup; calendars: HomeAssistantBinCalendar[] }
  | { ok: false; error: string };

/** POSTs JSON to one of the app's API routes. Each app supplies its own (origin, auth header). */
export type BinsPost = (path: string, body: Record<string, unknown>) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;

/**
 * The setup sheet's server reads. A council calendar photo or PDF goes to
 * POST /api/parse-bins (AI); Home Assistant's Waste Collection Schedule is
 * read through POST /api/bins/home-assistant. Both answer raw data,
 * normalized here against the device's today.
 */
export function createBinsSetupApi(post: BinsPost, today: () => string) {
  /** Reads a council calendar the app already turned into a data URL. */
  async function readCouncilCalendar(file: { dataUrl: string; pdf: boolean }): Promise<BinSetupResult> {
    const res = await post('/api/parse-bins', file.pdf ? { pdf: file.dataUrl } : { images: [file.dataUrl] });
    if (!res.ok) return res;
    const setup = normalizeParsedBins(res.data, today());
    if (setup.streams.length === 0) return { ok: false, error: 'No bin days found there. Try a clearer photo, or enter them yourself.' };
    return { ok: true, setup };
  }

  /** Reads bin days from Home Assistant: from `entityId`, or from the calendars that look like bin calendars. */
  async function readHomeAssistantBins(entityId?: string): Promise<HomeAssistantBinsResult> {
    const res = await post('/api/bins/home-assistant', entityId ? { entityId } : {});
    if (!res.ok) return res;
    const collections = Array.isArray(res.data.collections) ? (res.data.collections as { date: string; name: string }[]) : [];
    const calendars = Array.isArray(res.data.calendars) ? (res.data.calendars as HomeAssistantBinCalendar[]) : [];
    return { ok: true, setup: inferBinSetup(collections, today()), calendars };
  }

  return { readCouncilCalendar, readHomeAssistantBins };
}
