"use client";

// Settings > Integrations & keys > Feedback (server operators only): what
// people sent the Rooftap team through the Assistant, and crash reports from
// the error screen. New first; marking one done moves it under Done. On a
// self-hosted server the operator also decides here, once, whether crash
// reports go on to the Rooftap team. Native twin:
// apps/mobile/src/features/settings/panels/feedback-inbox.tsx.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquareText } from "lucide-react";
import {
  CRASH_SHARE_QUESTION,
  crashUpstreamIssueUrl,
  feedbackInboxDescription,
  feedbackItemMeta,
  offersUpstreamReport,
  type FeedbackInbox as Inbox,
  type FeedbackItem,
} from "@homeup/core";
import { Button } from "@/components/ui/button";
import { SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

async function request(body?: { id: string; done: boolean } | { crashSharing: "share" | "off" }): Promise<Inbox> {
  const res = await fetch("/api/admin/feedback", {
    method: body ? "PATCH" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `Server responded ${res.status}`), { status: res.status });
  return data as Inbox;
}

function Row({ item, upstream, busy, onToggle }: { item: FeedbackItem; upstream: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <div className="space-y-1.5 px-3.5 py-3">
      <p className={item.kind === "crash" ? "whitespace-pre-wrap font-mono text-xs" : "whitespace-pre-wrap text-sm"}>{item.message}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {feedbackItemMeta(item)}
          {item.issueUrl && (
            <>
              {" · "}
              <a href={item.issueUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                Issue
              </a>
            </>
          )}
          {upstream && (
            <>
              {" · "}
              <a href={crashUpstreamIssueUrl(item.message)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                Report upstream
              </a>
            </>
          )}
        </p>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onToggle}>
          {item.done ? "Reopen" : "Done"}
        </Button>
      </div>
    </div>
  );
}

export function FeedbackInbox() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    request()
      .then(setInbox)
      .catch((err: { status?: number }) => {
        // 403: not an operator. 404: a server from before this panel.
        if (err.status === 403 || err.status === 404) setHidden(true);
      });
  }, []);

  const share = async (crashSharing: "share" | "off") => {
    setBusy("sharing");
    try {
      setInbox(await request({ crashSharing }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (item: FeedbackItem) => {
    setBusy(item.id);
    try {
      setInbox(await request({ id: item.id, done: !item.done }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(null);
    }
  };

  // Operators only: nothing shows until the server says this person is one.
  if (hidden || !inbox) return null;
  const open = inbox.items.filter((i) => !i.done);
  const done = inbox.items.filter((i) => i.done);

  return (
    <SettingsPanel
      icon={MessageSquareText}
      title="Feedback"
      description={feedbackInboxDescription(inbox)}
    >
      {inbox.crashSharing === "ask" && (
        <SettingsInset className="mb-4 space-y-2 p-3.5">
          <p className="text-sm font-medium">{CRASH_SHARE_QUESTION.title}</p>
          <p className="text-xs text-muted-foreground">{CRASH_SHARE_QUESTION.body}</p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" disabled={busy === "sharing"} onClick={() => void share("share")}>
              {CRASH_SHARE_QUESTION.share}
            </Button>
            <Button size="sm" variant="outline" disabled={busy === "sharing"} onClick={() => void share("off")}>
              {CRASH_SHARE_QUESTION.keep}
            </Button>
          </div>
        </SettingsInset>
      )}
      {(inbox.crashSharing === "share" || inbox.crashSharing === "off") && !inbox.crashSharingFixed && (
        <SettingsInset className="mb-4">
          <SettingsSwitchRow
            title="Share crash reports with the Rooftap team"
            description="Without names, households or items."
            checked={inbox.crashSharing === "share"}
            disabled={busy === "sharing"}
            onChange={(on) => void share(on ? "share" : "off")}
          />
        </SettingsInset>
      )}
      {inbox.items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="space-y-4">
          {open.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>New</SettingsLabel>
              <SettingsInset>
                {open.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    upstream={offersUpstreamReport(inbox, item)}
                    busy={busy === item.id}
                    onToggle={() => void toggle(item)}
                  />
                ))}
              </SettingsInset>
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Done</SettingsLabel>
              <SettingsInset>
                {done.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    upstream={offersUpstreamReport(inbox, item)}
                    busy={busy === item.id}
                    onToggle={() => void toggle(item)}
                  />
                ))}
              </SettingsInset>
            </div>
          )}
        </div>
      )}
    </SettingsPanel>
  );
}
