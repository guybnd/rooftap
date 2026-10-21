"use client";

// HOUP-446: Settings > Assistant > Telegram. A member links their Telegram
// account with a one-time code (sent to the bot as /start CODE, or by
// opening the t.me link), after which the bot answers as them. While a code
// is showing, the panel checks every few seconds so it flips to "Linked" by
// itself. One primary action (PC).
// Native twin: apps/mobile/src/features/settings/panels/assistant-telegram.tsx.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import type { AssistantTelegramCode, AssistantTelegramStatus } from "@homeup/core";
import { assistantApi } from "@/lib/assistant-client";
import { Button } from "@/components/ui/button";
import { SettingsInset, SettingsPanel } from "@/components/settings-panel";

export function AssistantTelegram() {
  const [status, setStatus] = useState<AssistantTelegramStatus | null>(null);
  const [code, setCode] = useState<AssistantTelegramCode | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    assistantApi
      .telegramStatus()
      .then((s) => {
        setStatus(s);
        if (s.linked) setCode(null);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      if (Date.parse(code.expiresAt) < Date.now()) setCode(null);
      else load();
    }, 4000);
    return () => clearInterval(timer);
  }, [code, load]);

  const makeCode = async () => {
    setBusy(true);
    try {
      setCode(await assistantApi.telegramLinkCode());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not make a code.");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await assistantApi.telegramUnlink();
      setStatus((s) => (s ? { ...s, linked: null } : s));
      toast.message("Telegram disconnected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  // A server with no bot has nothing here anyone can use, so the panel stays out of the way.
  if (!status?.configured) return null;
  const bot = status.botUsername ? `@${status.botUsername}` : "the bot";

  return (
    <SettingsPanel
      icon={Send}
      title="Telegram"
      description="Talk to the assistant from Telegram. It answers as you, and the chat shows here in Rooftap too."
    >
      {(status.linked ? (
          <SettingsInset>
            <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {status.linked.username ? `Linked as @${status.linked.username}` : "Linked"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Message {bot}, or add it to a group and mention it.</p>
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => void unlink()}>
                Disconnect
              </Button>
            </div>
          </SettingsInset>
        ) : code ? (
          <div className="space-y-3">
            <SettingsInset>
              <div className="px-3.5 py-3">
                <p className="font-mono text-2xl font-semibold tracking-[0.2em] text-foreground tabular-nums">{code.code}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Send <span className="font-mono">/start {code.code}</span> to {bot}. The code works for 10 minutes.
                </p>
              </div>
            </SettingsInset>
            {code.link && (
              <a
                href={code.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                Open Telegram
              </a>
            )}
          </div>
        ) : (
          <Button disabled={busy} onClick={() => void makeCode()}>
            Link Telegram
          </Button>
        ))}
    </SettingsPanel>
  );
}
