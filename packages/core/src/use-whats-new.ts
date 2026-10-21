'use client';

// React glue for whats-new.ts, shared by the native sheet and the web dialog.
// Seen state is per device, behind getStoreEnvironment().keyValue
// (localStorage on web, sqlite on native), read in an effect so a web SSR
// pass and the first client paint agree (nothing open).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStoreEnvironment } from './data/store-environment';
import { todayISO } from './date-utils';
import { useModules } from './modules-store';
import { WHATS_NEW_ENTRIES, WHATS_NEW_RELEASES } from './whats-new.generated';
import {
  WHATS_NEW_SEEN_KEY,
  buildWhatsNewView,
  isEntryVisible,
  resolveSeen,
  serializeSeen,
  unseenEntries,
  type WhatsNewContext,
  type WhatsNewPlatform,
  type WhatsNewView,
} from './whats-new';

function readSeen(): string | null {
  try {
    return getStoreEnvironment().keyValue.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(value: string): void {
  try {
    getStoreEnvironment().keyValue.setItem(WHATS_NEW_SEEN_KEY, value);
  } catch {
    // Storage unavailable: worst case the sheet shows again next launch.
  }
}

function useContext(platform: WhatsNewPlatform, hidden: readonly string[] | null | undefined): WhatsNewContext {
  const modules = useModules();
  return useMemo(
    () => ({
      platform,
      enabled: modules.enabled,
      hidden,
      serverSupports: (id: string) => modules.server(id as Parameters<typeof modules.server>[0]),
    }),
    [platform, modules, hidden]
  );
}

export interface UseWhatsNew {
  /** Show the sheet now. */
  open: boolean;
  /** What it shows, frozen when it opened so a sync mid-read doesn't reshuffle it. */
  view: WhatsNewView | null;
  /** Mark everything in the view seen and close. */
  dismiss: () => void;
}

/**
 * The launch sheet's state. `ready` is the caller's "Home has painted, no
 * sign-in or first-run step or other sheet is up"; modules must also have
 * loaded, so an entry for a module that's off never flashes.
 */
export function useWhatsNew(input: {
  platform: WhatsNewPlatform;
  hidden?: readonly string[] | null;
  ready: boolean;
}): UseWhatsNew {
  const { known } = useModules();
  const ctx = useContext(input.platform, input.hidden);
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [view, setView] = useState<WhatsNewView | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { seen: initial, seeded } = resolveSeen(readSeen(), WHATS_NEW_ENTRIES, todayISO());
    if (seeded) writeSeen(serializeSeen(initial, [], WHATS_NEW_ENTRIES));
    setSeen(initial);
  }, []);

  useEffect(() => {
    if (done || view || !seen || !known || !input.ready) return;
    const unseen = unseenEntries(WHATS_NEW_ENTRIES, seen, ctx, todayISO());
    if (unseen.length) setView(buildWhatsNewView(unseen, WHATS_NEW_RELEASES));
  }, [done, view, seen, known, input.ready, ctx]);

  const dismiss = useCallback(() => {
    setDone(true);
    if (!view || !seen) return;
    const ids = [...view.spotlights, ...view.groups.flatMap((g) => g.entries), ...view.fixes].map((e) => e.id);
    // Rows past the cap count as seen too: the sheet told you they exist.
    const shown = new Set(ids);
    const rest = unseenEntries(WHATS_NEW_ENTRIES, seen, ctx, todayISO()).filter((e) => !shown.has(e.id));
    writeSeen(serializeSeen(seen, [...ids, ...rest.map((e) => e.id)], WHATS_NEW_ENTRIES));
  }, [view, seen, ctx]);

  return { open: !!view && !done, view: done ? null : view, dismiss };
}

/** Every entry this person has the feature for, by release, for Settings' What's new list. */
export function useWhatsNewHistory(input: { platform: WhatsNewPlatform; hidden?: readonly string[] | null }): WhatsNewView {
  const ctx = useContext(input.platform, input.hidden);
  return useMemo(
    () =>
      buildWhatsNewView(
        WHATS_NEW_ENTRIES.filter((e) => isEntryVisible(e, ctx)),
        WHATS_NEW_RELEASES,
        { maxRows: Infinity, spotlights: false, foldFixes: false }
      ),
    [ctx]
  );
}
