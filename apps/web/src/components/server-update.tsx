"use client";

// A newer Rooftap release for this server, shown only to the people who run
// it (core app-release.ts, GET /api/server-update): a panel in Settings >
// About & updates with the steps, and a one-time toast per release. The
// phone twin is apps/mobile's ServerUpdatePanel and useUpdateToasts.
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Server } from "lucide-react";
import {
  SERVER_UPGRADE_COMMANDS,
  SERVER_UPGRADE_DOCS_URL,
  SEEN_SERVER_UPDATE_KEY,
  serverUpdateNotice,
  shouldAnnounceServerUpdate,
  useServerUpdate,
} from "@homeup/core";
import { buttonVariants } from "@/components/ui/button";
import { SettingsPanel } from "@/components/settings-panel";
import { useDataCache } from "@/lib/data-cache";

const ABOUT_HREF = "/settings/whats-new";
const TOAST_MS = 15000;

async function fetchServerUpdate(): Promise<unknown> {
  const res = await fetch("/api/server-update");
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json();
}

export function ServerUpdatePanel() {
  const update = useServerUpdate(fetchServerUpdate, useDataCache().currentUserId);
  if (!update) return null;
  const notice = serverUpdateNotice(update);
  return (
    <SettingsPanel icon={Server} title={notice.title}>
      <p className="text-sm text-muted-foreground">{notice.description}</p>
      <p className="text-sm text-muted-foreground">Back up first, then run these in the server&apos;s Rooftap folder:</p>
      <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
        {SERVER_UPGRADE_COMMANDS.join("\n")}
      </pre>
      <div className="flex flex-wrap gap-2">
        <a href={update.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
          What changed
        </a>
        <a href={SERVER_UPGRADE_DOCS_URL} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
          Upgrade guide
        </a>
      </div>
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
