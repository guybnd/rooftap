"use client";

import { useEffect } from "react";

// The only real data-loss risk in this local-first app is queued unsynced
// offline writes (IndexedDB via @legendapp/state/persist-plugins/indexeddb —
// see src/lib/legend/environment.ts); everything else re-syncs from
// Supabase. Requesting persistent storage tells the browser not to silently
// evict that IndexedDB under storage pressure. Fire-and-forget: denial is
// non-fatal and never surfaced to the user, and persisted() makes repeat
// mounts a no-op.

export function PersistentStorage() {
  useEffect(() => {
    if (!navigator.storage?.persist || !navigator.storage.persisted) return;
    navigator.storage
      .persisted()
      .then((already) => {
        if (!already) return navigator.storage.persist();
      })
      .catch(() => {});
  }, []);

  return null;
}
