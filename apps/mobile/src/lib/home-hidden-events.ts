// Household events someone swiped off Home (the Upcoming feed). Device-local,
// like web's dismissed Google Calendar rows: the event stays on the calendar
// and for everyone else. Stored in the synchronous kv-store so Home's first
// render already leaves them out.
import * as React from 'react';
import { nativeStoreEnvironment } from './legend/environment';

const HIDDEN_EVENTS_KEY = 'homeup-home-hidden-events';

/** The ids hidden on this device; the home-screen widget's feed leaves them out too. */
export function readHomeHiddenEventIds(): string[] {
  try {
    const raw = nativeStoreEnvironment.keyValue.getItem(HIDDEN_EVENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeStored(ids: string[]) {
  try {
    nativeStoreEnvironment.keyValue.setItem(HIDDEN_EVENTS_KEY, JSON.stringify(ids));
  } catch {
    // kv-store unavailable: the row stays hidden for this session.
  }
}

/**
 * `liveIds` are the events that still exist; anything else is dropped from
 * the list when it next changes, so it never outgrows the calendar.
 */
export function useHomeHiddenEvents(liveIds: readonly string[]) {
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(() => new Set(readHomeHiddenEventIds()));
  const liveRef = React.useRef(liveIds);
  liveRef.current = liveIds;

  const update = React.useCallback((change: (next: Set<string>) => void) => {
    setHidden((prev) => {
      const live = new Set(liveRef.current);
      const next = new Set([...prev].filter((id) => live.has(id)));
      change(next);
      writeStored([...next]);
      return next;
    });
  }, []);
  const hide = React.useCallback((id: string) => update((next) => next.add(id)), [update]);
  const unhide = React.useCallback((id: string) => update((next) => next.delete(id)), [update]);
  return { hidden, hide, unhide };
}
