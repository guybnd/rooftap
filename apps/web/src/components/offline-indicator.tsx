"use client";

import { useEffect, useRef, useState } from "react";
import { useDataCache } from "@/lib/data-cache";
import { useLegendPendingCount } from "@/lib/legend/sync-status";
import { WifiOffIcon, CloudIcon, Loader2Icon, CheckIcon } from "lucide-react";

// How long the brief "synced" confirmation stays up once pending drains to 0.
const SYNCED_CONFIRMATION_MS = 2500;

export function OfflineIndicator() {
  const { isOnline, lastSyncedAt } = useDataCache();
  // FLUX-150: every write path now goes through the Legend-State outbox
  // (recipes, checklists, groceries, home search, appointments, …) — the old
  // hand-rolled sync-queue.ts counter it used to add here was retired
  // alongside it (it was always 0 anyway; nothing ever enqueued to it).
  const totalPending = useLegendPendingCount();

  // Tracks whether there was pending work recently, so draining to 0 shows a
  // brief "synced" confirmation instead of silently vanishing — distinct from
  // the steady-state "nothing to report" case, which stays silent (H1).
  const wasPendingRef = useRef(false);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (totalPending > 0) {
      wasPendingRef.current = true;
      return;
    }
    if (isOnline && wasPendingRef.current) {
      wasPendingRef.current = false;
      setShowSynced(true);
      const timer = setTimeout(() => setShowSynced(false), SYNCED_CONFIRMATION_MS);
      return () => clearTimeout(timer);
    }
  }, [isOnline, totalPending]);

  if (isOnline && totalPending === 0 && !showSynced) return null;

  const formatLastSync = (iso: string | null) => {
    if (!iso) return "never";
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  };

  if (!isOnline) {
    return (
      <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning md:mx-6">
        <WifiOffIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          Offline mode: changes saved locally
          {lastSyncedAt && <span className="ml-1 opacity-70">(last sync: {formatLastSync(lastSyncedAt)})</span>}
        </span>
        {totalPending > 0 && (
          <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-medium">
            {totalPending} pending
          </span>
        )}
      </div>
    );
  }

  // Online with pending sync items (failed retries or still draining).
  if (totalPending > 0) {
    return (
      <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary md:mx-6">
        <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="flex-1">Syncing {totalPending} pending changes...</span>
        <CloudIcon className="h-3.5 w-3.5 shrink-0" />
      </div>
    );
  }

  // Brief confirmation once pending drains to 0 — distinct from "offline" and
  // "syncing" so a user who was offline can tell their edits actually landed.
  return (
    <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success md:mx-6">
      <CheckIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">Synced</span>
    </div>
  );
}
