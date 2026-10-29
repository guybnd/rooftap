'use client';

// Bin night: the screen and setup-sheet state both apps share. The apps keep
// their own rendering, toasts and file pickers, and pass in how they read a
// council calendar and Home Assistant.

import { useMemo, useRef, useState } from 'react';
import { todayISO } from '../../date-utils';
import {
  binDraftsFrom,
  newBinStreamDraft,
  realignBinAnchor,
  upcomingBinCollections,
  type BinChangeDraft,
  type BinSource,
  type BinStreamDraft,
  type ParsedBinSetup,
} from './bins';
import {
  binReadNote,
  binStripDays,
  binTurnCaption,
  binsLede,
  comingBinChanges,
  nextFreeBinLid,
  type BinSetupResult,
  type HomeAssistantBinCalendar,
  type HomeAssistantBinsResult,
} from './bins-view';
import type { BinsApi } from './use-bins';

/** The Bins screen: what the Hero, strip, coming collections and changes show. */
export function useBinsScreen(bins: BinsApi, currentUserId: string | null | undefined, nameOf: (id: string | null) => string) {
  const today = todayISO();
  const { streams, changes, night } = bins;
  const upcoming = useMemo(() => upcomingBinCollections(streams, changes, today, 6), [streams, changes, today]);
  const stripDays = useMemo(() => binStripDays(streams, changes, today), [streams, changes, today]);
  const comingChanges = useMemo(() => comingBinChanges(changes, today), [changes, today]);
  const streamName = useMemo(() => new Map(streams.map((s) => [s.id, s.name])), [streams]);

  /** "You" for the viewer, else the app's name for the member. */
  const who = (id: string | null) => (id === currentUserId ? 'You' : nameOf(id));
  const turnCaption = (id: string | null) => binTurnCaption(id, currentUserId, nameOf);
  const lede = binsLede(night, today, turnCaption);

  /** Marks tonight's bins out; `onDone` gets the undo for the app's toast. */
  const markOut = (onDone: (undo: () => void) => void) => {
    if (!night.collection) return;
    bins.markOut(night.collection.date);
    onDone(() => bins.undoOut());
  };

  return { today, upcoming, stripDays, comingChanges, streamName, who, turnCaption, lede, markOut };
}

export type BinSetupMethod = BinSource;

/**
 * The setup sheet: bins and changes as drafts, reminder times, the turn
 * rotation, and reads from a council calendar or Home Assistant that fill
 * the drafts in. Nothing is saved until `submit`.
 */
export function useBinSetup(input: {
  bins: BinsApi;
  today: string;
  readHomeAssistantBins: (entityId?: string) => Promise<HomeAssistantBinsResult>;
}) {
  const { bins, today } = input;
  const saved = useMemo(() => binDraftsFrom(bins.streams, bins.changes, today), [bins.streams, bins.changes, today]);
  const [method, setMethod] = useState<BinSetupMethod>((bins.plan?.setup_source as BinSetupMethod) ?? 'manual');
  const [streams, setStreams] = useState<BinStreamDraft[]>(() => (saved.streams.length ? saved.streams : [newBinStreamDraft('new-0', today)]));
  const [changes, setChanges] = useState<BinChangeDraft[]>(saved.changes);
  const [remindAt, setRemindAt] = useState(bins.plan?.remind_at ?? '19:00');
  const [pushOn, setPushOn] = useState(bins.plan ? bins.plan.push_at !== null : true);
  const [pushAt, setPushAt] = useState(bins.plan?.push_at ?? '21:00');
  const [rotation, setRotation] = useState<string[]>(bins.plan?.rotation ?? []);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [haCalendars, setHaCalendars] = useState<HomeAssistantBinCalendar[]>([]);
  const [tried, setTried] = useState(false);
  const nextKey = useRef(1);
  const key = (prefix: string) => `${prefix}-${nextKey.current++}`;

  const updateStream = (k: string, patch: Partial<BinStreamDraft>) =>
    setStreams((all) => all.map((s) => (s.key === k ? realignBinAnchor({ ...s, ...patch }, today) : s)));

  /** Removes a bin and the changes that were only for it. */
  const removeStream = (k: string) => {
    setStreams((all) => all.filter((x) => x.key !== k));
    setChanges((all) => all.filter((c) => c.streamKey !== k));
  };

  /** Adds a fortnightly bin with the next free lid colour, on the first bin's day. */
  const addStream = () => {
    const lid = nextFreeBinLid(streams);
    setStreams((all) => [...all, { ...newBinStreamDraft(key('new'), today, lid, all[0]?.weekday), every_weeks: 2 }]);
  };

  const addChange = (c: Omit<BinChangeDraft, 'key'>) =>
    setChanges((all) => [...all, { ...c, key: key('nc') }].sort((a, b) => a.on_date.localeCompare(b.on_date)));
  const removeChange = (k: string) => setChanges((all) => all.filter((x) => x.key !== k));

  const pickMethod = (m: BinSetupMethod) => {
    setMethod(m);
    setReadError(null);
    setReadNote(null);
  };

  const applyRead = (setup: ParsedBinSetup, source: BinSource) => {
    // Keep ids of bins already saved under the same name, so their changes and history stay put.
    const byName = new Map(saved.streams.map((s) => [s.name.toLowerCase(), s]));
    const keyMap = new Map<string, string>();
    const merged = setup.streams.map((s) => {
      const existing = byName.get(s.name.toLowerCase());
      const k = existing?.key ?? key('read');
      keyMap.set(s.key, k);
      return { ...s, key: k, id: existing?.id };
    });
    setStreams(merged);
    setChanges(setup.changes.map((c) => ({ ...c, key: key('rc'), streamKey: c.streamKey === null ? null : (keyMap.get(c.streamKey) ?? null) })));
    setReadNote(binReadNote(setup, merged.length));
    setMethod(source === 'council' ? 'council' : 'home-assistant');
  };

  /** Runs the app's council-calendar read (a picker, then the server). A null result means the picker was cancelled. */
  /**
   * Runs a read with the sheet in its reading state. A read that throws (a
   * picker or file error, a reply that isn't JSON) shows an error instead of
   * leaving the sheet stuck on "Reading…". Null: the picker was cancelled.
   */
  const runRead = async <T>(read: () => Promise<T | null>): Promise<T | null> => {
    setReading(true);
    setReadError(null);
    setReadNote(null);
    try {
      return await read();
    } catch {
      setReadError("Couldn't read that. Try again, or enter the days yourself.");
      return null;
    } finally {
      setReading(false);
    }
  };

  const readCouncil = async (read: () => Promise<BinSetupResult | null>) => {
    const result = await runRead(read);
    if (!result) return;
    if (!result.ok) setReadError(result.error);
    else applyRead(result.setup, 'council');
  };

  const readHomeAssistant = async (entityId?: string) => {
    const result = await runRead(() => input.readHomeAssistantBins(entityId));
    if (!result) return;
    if (!result.ok) {
      setReadError(result.error);
      return;
    }
    setHaCalendars(result.calendars);
    if (result.setup.streams.length === 0) {
      setReadError(
        result.calendars.length
          ? 'No bin calendar found by name. Pick the one that has your bin days.'
          : 'Home Assistant has no calendars. Add the Waste Collection Schedule integration there first.',
      );
      return;
    }
    applyRead(result.setup, 'home-assistant');
  };

  const toggleMember = (id: string) => setRotation((r) => (r.includes(id) ? r.filter((m) => m !== id) : [...r, id]));
  const streamLabel = (k: string | null) => (k === null ? 'Every bin' : (streams.find((s) => s.key === k)?.name ?? 'Bin'));

  /** Saves the setup. False when a bin has no name (the sheet then shows the errors). */
  const submit = (): boolean => {
    setTried(true);
    if (streams.length === 0 || streams.some((s) => !s.name.trim())) return false;
    bins.saveSetup({
      streams,
      changes,
      remindAt,
      pushAt: pushOn ? pushAt : null,
      rotation,
      rotationAnchor: rotation.length > 1 ? (rotation[0] === bins.plan?.rotation[0] ? bins.plan?.rotation_anchor : today) : null,
      source: method,
    });
    return true;
  };

  return {
    method,
    pickMethod,
    streams,
    changes,
    remindAt,
    setRemindAt,
    pushOn,
    setPushOn,
    pushAt,
    setPushAt,
    rotation,
    reading,
    readNote,
    readError,
    haCalendars,
    tried,
    updateStream,
    removeStream,
    addStream,
    addChange,
    removeChange,
    readCouncil,
    readHomeAssistant,
    toggleMember,
    streamLabel,
    submit,
  };
}
