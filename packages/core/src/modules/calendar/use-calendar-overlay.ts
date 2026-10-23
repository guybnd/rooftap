'use client';

// The Google Calendar overlay behind both calendar screens: the connection,
// the pulled events for the range on screen, the event the detail sheet shows,
// and its share / dismiss / import actions. Each app passes its own
// createCalendarApi client and keeps its own sheet, toasts and haptics.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GoogleCalendarEventWithAttribution } from '../../types';
import type { CalendarApi } from './calendar-api';
import { hideViewingSuggestions } from './calendar-sources';

export interface CalendarOverlayOptions {
  api: CalendarApi;
  /** The 'calendar.google-events' module feature: off, nothing is fetched. */
  enabled: boolean;
  /** The 'calendar.viewings' module feature: off, viewing suggestions are hidden. */
  showViewings: boolean;
  /** The range on screen, [from, to). */
  from: Date;
  to: Date;
  /** The app's error toast. */
  notifyError: (message: string) => void;
  /** After an import lands, before the overlay reloads (the phone's success haptic). */
  onImported?: () => void;
  /** After a dismiss or an import closes the detail. */
  onClosed?: () => void;
}

const ALREADY_IMPORTED = 'This event has already been imported.';

export function useCalendarOverlay({ api, enabled, showViewings, from, to, notifyError, onImported, onClosed }: CalendarOverlayOptions) {
  const [connected, setConnected] = useState(false);
  const [pulled, setPulled] = useState<GoogleCalendarEventWithAttribution[]>([]);
  const [selected, setSelected] = useState<GoogleCalendarEventWithAttribution | null>(null);
  const [busy, setBusy] = useState(false);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  // Best-effort supplementary content: a failed or unanswered call keeps what's shown.
  const refresh = useCallback(async () => {
    if (!enabled) {
      setConnected(false);
      setPulled([]);
      return;
    }
    try {
      const status = await api.status();
      if (!status) return;
      setConnected(status.connected);
      if (!status.connected) {
        setPulled([]);
        return;
      }
      const events = await api.events(new Date(fromMs), new Date(toMs));
      if (events) setPulled(events);
    } catch {
      // fail silently
    }
  }, [api, enabled, fromMs, toMs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const events = useMemo(() => hideViewingSuggestions(pulled, showViewings), [pulled, showViewings]);

  const run = async (action: (event: GoogleCalendarEventWithAttribution) => Promise<void>) => {
    if (!selected) return;
    setBusy(true);
    try {
      await action(selected);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setSelected(null);
    onClosed?.();
  };

  const toggleShare = () =>
    run(async (ev) => {
      const shared = ev.visibility === 'group';
      const result = await (shared ? api.unshare(ev.id) : api.share(ev.id));
      if (!result.ok) return;
      setSelected({ ...ev, visibility: shared ? 'private' : 'group' });
      await refresh();
    });

  const dismiss = () =>
    run(async (ev) => {
      const result = await api.dismiss(ev.id);
      if (!result.ok) return;
      close();
      await refresh();
    });

  const importAsTask = () =>
    run(async (ev) => {
      const result = await api.importAsTask(ev.id);
      if (!result.ok) {
        notifyError(result.error === 'already_imported' ? ALREADY_IMPORTED : 'Could not add as to-do. Please try again.');
        return;
      }
      onImported?.();
      await refresh();
      close();
    });

  const importAsAppointment = (apartmentId: string) =>
    run(async (ev) => {
      const result = await api.importAsAppointment(ev.id, apartmentId);
      if (!result.ok) {
        notifyError(result.error === 'already_imported' ? ALREADY_IMPORTED : 'Could not import as appointment. Please try again.');
        return;
      }
      onImported?.();
      await refresh();
      close();
    });

  return { connected, events, refresh, selected, setSelected, busy, toggleShare, dismiss, importAsTask, importAsAppointment };
}
