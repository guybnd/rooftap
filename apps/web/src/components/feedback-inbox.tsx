"use client";

// Settings > Integrations & keys > Feedback (server operators only): what
// people sent the Rooftap team through the Assistant. New first; marking one
// done moves it under Done. Native twin:
// apps/mobile/src/features/settings/panels/feedback-inbox.tsx.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquareText } from "lucide-react";
import { timeAgo, type FeedbackInbox as Inbox, type FeedbackItem } from "@homeup/core";
import { Button } from "@/components/ui/button";
import { SettingsInset, SettingsLabel, SettingsPanel } from "@/components/settings-panel";

async function request(body?: { id: string; done: boolean }): Promise<Inbox> {
  const res = await fetch("/api/admin/feedback", {
    method: body ? "PATCH" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `Server responded ${res.status}`), { status: res.status });
  return data as Inbox;
}

function Row({ item, busy, onToggle }: { item: FeedbackItem; busy: boolean; onToggle: () => void }) {
  return (
    <div className="space-y-1.5 px-3.5 py-3">
      <p className="whitespace-pre-wrap text-sm">{item.message}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {[item.from ?? "A deleted account", timeAgo(item.createdAt)].filter(Boolean).join(" · ")}
          {item.issueUrl && (
            <>
              {" · "}
              <a href={item.issueUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                Issue
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
      description={
        inbox.github
          ? "What people sent through the Assistant, from every household on this server. Each one also opened a GitHub issue."
          : "What people sent through the Assistant, from every household on this server."
      }
    >
      {inbox.items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="space-y-4">
          {open.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>New</SettingsLabel>
              <SettingsInset>
                {open.map((item) => (
                  <Row key={item.id} item={item} busy={busy === item.id} onToggle={() => void toggle(item)} />
                ))}
              </SettingsInset>
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Done</SettingsLabel>
              <SettingsInset>
                {done.map((item) => (
                  <Row key={item.id} item={item} busy={busy === item.id} onToggle={() => void toggle(item)} />
                ))}
              </SettingsInset>
            </div>
          )}
        </div>
      )}
    </SettingsPanel>
  );
}
