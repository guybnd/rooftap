"use client";

// A newer Rooftap release for this server, shown only to the people who run
// it (core app-release.ts, GET /api/server-update): a panel in Settings >
// About & updates, and a one-time toast per release. With one-click updates
// on (scripts/updater/, core server-updater.ts) the panel has an Update
// button and follows the run; without them it shows the manual steps. The
// phone twin is apps/mobile's ServerUpdatePanel and useUpdateToasts.
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Server } from "lucide-react";
import {
  SERVER_UPDATER_INSTALL_COMMAND,
  SERVER_UPGRADE_COMMANDS,
  SERVER_UPGRADE_DOCS_URL,
  SEEN_SERVER_UPDATE_KEY,
  currentUpdaterStatus,
  refreshServerUpdate,
  serverUpdateNotice,
  serverUpdatePanelCopy,
  serverUpdatePanelKind,
  shouldAnnounceServerUpdate,
  updaterStepRows,
  useServerUpdate,
  useServerUpdater,
  type UpdaterStepRow,
} from "@homeup/core";
import { Button, buttonVariants } from "@/components/ui/button";
import { SettingsPanel } from "@/components/settings-panel";
import { useDataCache } from "@/lib/data-cache";
import { cn } from "@/lib/utils";

const ABOUT_HREF = "/settings/whats-new";
const TOAST_MS = 15000;

async function fetchServerUpdate(): Promise<unknown> {
  const res = await fetch("/api/server-update", { cache: "no-store" });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json();
}

async function startServerUpdate(version: string): Promise<void> {
  const res = await fetch("/api/server-update/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The server could not start the update.");
  }
}

function Commands({ lines }: { lines: readonly string[] }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">{lines.join("\n")}</pre>
  );
}

function Steps({ rows }: { rows: UpdaterStepRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ol className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className={cn("flex items-center gap-2.5 text-sm", row.state === "todo" && "text-muted-foreground")}>
          <span
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 rounded-full border-2",
              row.state === "done" && "border-success bg-success",
              row.state === "fail" && "border-destructive bg-destructive",
              row.state === "run" && "animate-spin border-primary border-t-transparent motion-reduce:animate-none",
              row.state === "todo" && "border-border"
            )}
          />
          <span>{row.label}</span>
          <span className="sr-only">{row.state === "run" ? "(running)" : row.state === "fail" ? "(failed)" : row.state === "done" ? "(done)" : ""}</span>
        </li>
      ))}
    </ol>
  );
}

export function ServerUpdatePanel() {
  const userId = useDataCache().currentUserId;
  const update = useServerUpdate(fetchServerUpdate, userId);
  const updater = useServerUpdater(fetchServerUpdate, userId);
  const [confirming, setConfirming] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const kind = serverUpdatePanelKind(update, updater);
  if (!kind) return null;
  const copy = serverUpdatePanelCopy(kind, update, updater);
  const status = currentUpdaterStatus(updater?.status ?? null);
  const latest = update?.latest;

  const start = async () => {
    if (!latest) return;
    setStarting(true);
    try {
      await startServerUpdate(latest);
      setConfirming(false);
      await refreshServerUpdate(fetchServerUpdate);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The server could not start the update.");
    } finally {
      setStarting(false);
    }
  };

  const whatChanged = update ? (
    <a href={update.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
      What changed
    </a>
  ) : null;

  if (kind === "manual" && update) {
    const notice = serverUpdateNotice(update);
    return (
      <SettingsPanel icon={Server} title={notice.title} description={copy.subtitle}>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        <Commands lines={[SERVER_UPDATER_INSTALL_COMMAND]} />
        <p className="text-sm text-muted-foreground">Or back up first, then update by hand:</p>
        <Commands lines={SERVER_UPGRADE_COMMANDS} />
        <div className="flex flex-wrap gap-2">
          {whatChanged}
          <a href={SERVER_UPGRADE_DOCS_URL} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
            Upgrade guide
          </a>
        </div>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel icon={Server} title={copy.title} description={copy.subtitle}>
      {kind === "ready" && update && (
        <p className="font-heading text-2xl font-semibold tabular-nums">
          {update.current} <span className="text-base font-normal text-muted-foreground">to</span> {update.latest}
        </p>
      )}
      {kind === "done" && status?.target && <p className="font-heading text-2xl font-semibold tabular-nums">{status.target}</p>}
      {(kind === "running" || kind === "failed" || kind === "rolled-back") && (
        <Steps rows={updaterStepRows(status, updater?.pending)} />
      )}
      {copy.body && !confirming && <p className="text-sm text-muted-foreground">{copy.body}</p>}
      {confirming && latest ? (
        <div className="space-y-3 rounded-2xl bg-muted/60 p-3">
          <p className="text-sm font-medium">Update the server to {latest}?</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Backs up the database and files first</li>
            <li>Everyone is offline for about a minute</li>
            <li>Goes back to {update?.current} and your data if anything fails</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={start} disabled={starting}>
              {starting ? "Starting" : "Update now"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={starting}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        (kind === "ready" || ((kind === "failed" || kind === "rolled-back" || kind === "stuck") && update && updater?.installed)) && (
          <div className="flex flex-wrap gap-2">
            {kind === "ready" && latest && <Button size="sm" onClick={() => setConfirming(true)}>Update to {latest}</Button>}
            {(kind === "failed" || kind === "rolled-back" || kind === "stuck") && latest && <Button size="sm" onClick={() => setConfirming(true)}>Try again</Button>}
            {whatChanged}
          </div>
        )
      )}
    </SettingsPanel>
  );
}

/** Mounted once in the signed-in shell: tells an admin about each new release once per browser. */
export function ServerUpdateToast() {
  const router = useRouter();
  const update = useServerUpdate(fetchServerUpdate, useDataCache().currentUserId);
  React.useEffect(() => {
    if (!update) return;
    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(SEEN_SERVER_UPDATE_KEY);
    } catch {
      // Storage unavailable: announce, and maybe again next visit.
    }
    if (!shouldAnnounceServerUpdate(update, seen)) return;
    try {
      window.localStorage.setItem(SEEN_SERVER_UPDATE_KEY, update.latest);
    } catch {
      // Worst case the toast repeats next visit.
    }
    const notice = serverUpdateNotice(update);
    toast.message(notice.title, {
      description: notice.description,
      duration: TOAST_MS,
      action: { label: "How to update", onClick: () => router.push(ABOUT_HREF) },
    });
  }, [update, router]);
  return null;
}
