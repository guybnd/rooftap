"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDataCache } from "@/lib/data-cache";
import { useLegendPendingCount } from "@/lib/legend/sync-status";
import { dismissWriteFailures, useWriteFailures, type WriteFailure } from "@homeup/core";
import { WifiOffIcon, Loader2Icon, CheckIcon, AlertCircleIcon } from "lucide-react";

// How long the brief "synced" confirmation stays up once pending drains to 0.
const SYNCED_CONFIRMATION_MS = 2500;

export function OfflineIndicator() {
  const { isOnline, lastSyncedAt } = useDataCache();
  // FLUX-150: every write path now goes through the Legend-State outbox
  // (recipes, checklists, groceries, home search, appointments, …) — the old
  // hand-rolled sync-queue.ts counter it used to add here was retired
  // alongside it (it was always 0 anyway; nothing ever enqueued to it).
  const totalPending = useLegendPendingCount();
  // Writes the server refused (dropped from the outbox), so a change that
  // never landed is said out loud instead of hanging as "Syncing" forever.
  const failures = useWriteFailures();

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

  if (isOnline && failures.length > 0) return <WriteFailureBanner failures={failures} />;

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

  // Hearth §13.13: a small chip at the top right, not a band. The app works
  // offline, so it says so quietly; it takes no room, so nothing below moves.
  if (!isOnline) {
    return (
      <SyncChip label={lastSyncedAt ? `Offline. Last synced ${formatLastSync(lastSyncedAt)}` : "Offline"}>
        <WifiOffIcon className="size-3.5 shrink-0 text-warning" />
        <span>
          Offline{totalPending > 0 ? ` · ${totalPending} to sync` : " · saved here"}
        </span>
      </SyncChip>
    );
  }

  // Online with pending sync items (failed retries or still draining).
  if (totalPending > 0) {
    return (
      <SyncChip label={`Syncing ${totalPending} ${totalPending === 1 ? "change" : "changes"}`}>
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        <span>Syncing {totalPending}</span>
      </SyncChip>
    );
  }

  // Brief confirmation once pending drains to 0, so a person who was offline
  // can tell their edits actually landed.
  return (
    <SyncChip label="Synced">
      <CheckIcon className="size-3.5 shrink-0 text-success" />
      <span>Synced</span>
    </SyncChip>
  );
}

function SyncChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none sticky top-2 z-20 flex h-0 justify-end overflow-visible px-4 md:px-6">
      <span
        role="status"
        title={label}
        aria-label={label}
        className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 text-xs font-medium text-foreground shadow-sm backdrop-blur"
      >
        {children}
      </span>
    </div>
  );
}

function tableLabel(collection: string): string {
  return collection.replace(/_/g, " ");
}

function WriteFailureBanner({ failures }: { failures: WriteFailure[] }) {
  const latest = failures[failures.length - 1];
  const count = failures.length;
  return (
    <div
      role="alert"
      className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive md:mx-6"
    >
      <AlertCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {count === 1
          ? `A change to ${tableLabel(latest.collection)} couldn't be saved.`
          : `${count} changes couldn't be saved.`}{" "}
        It stays on this device only.
        <span className="mt-0.5 block break-words opacity-70">{latest.message}</span>
      </span>
      <button
        type="button"
        onClick={dismissWriteFailures}
        className="shrink-0 rounded-md px-2 py-0.5 font-medium hover:bg-destructive/15"
      >
        Dismiss
      </button>
    </div>
  );
}
