"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsLabel, SettingsPanel } from "@/components/settings-panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Bot, KeyRound, Copy, Check } from "lucide-react";
import { timeAgo, timeUntil, DEFAULT_PAT_EXPIRY, PAT_EXPIRY_OPTIONS, type PatExpiryChoice } from '@homeup/core';
import { dialog } from '@homeup/core';
import { toast } from "sonner";

interface PatStatus {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

type State = { state: "checking" } | { state: "none" } | { state: "active"; pat: PatStatus };

export function PatSettings() {
  const [state, setState] = useState<State>({ state: "checking" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiry, setExpiry] = useState<PatExpiryChoice>(DEFAULT_PAT_EXPIRY);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pat");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setState(data.active ? { state: "active", pat: data.pat } : { state: "none" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API key status.");
      setState({ state: "none" });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
      setRevealToken(data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate API key.");
    } finally {
      setBusy(false);
    }
  }, [load, expiry]);

  const refresh = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pat", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
      setRevealToken(data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh API key.");
    } finally {
      setBusy(false);
    }
  }, [load, expiry]);

  const revoke = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: "Revoke this API key?",
      message: "Anything using it will stop working immediately.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pat", { method: "DELETE" });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setState({ state: "none" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke API key.");
    } finally {
      setBusy(false);
    }
  }, []);

  const copyToken = useCallback(() => {
    if (!revealToken) return;
    navigator.clipboard.writeText(revealToken);
    setCopied(true);
    toast.success("API key copied");
  }, [revealToken]);

  const closeReveal = useCallback(() => {
    setRevealToken(null);
    setCopied(false);
  }, []);

  return (
    <>
      <SettingsPanel
        icon={Bot}
        title="Bot API key"
        description="A personal access token so an outside agent can read your Rooftap data."
      >
        {state.state === "checking" && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {state.state === "none" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
            <SettingsLabel>New key expires</SettingsLabel>
            <SegmentedControl
              ariaLabel="Key expiry"
              options={PAT_EXPIRY_OPTIONS}
              value={expiry}
              onChange={setExpiry}
              size="sm"
            />
          </div>
            <Button onClick={generate} disabled={busy} size="lg" variant="outline" className="px-3">
              <KeyRound className="h-4 w-4" />
              Generate API key
            </Button>
          </div>
        )}

        {state.state === "active" && (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/30 px-3.5 py-3">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${state.pat.expired ? "bg-warning" : "bg-success"}`}
                />
                {state.pat.expired ? "Expired" : "Active"}
              </p>
              {/* H6: one middle dot per line. */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Issued {timeAgo(state.pat.createdAt)}
                {" · "}
                {state.pat.lastUsedAt ? `last used ${timeAgo(state.pat.lastUsedAt)}` : "never used"}
              </p>
              <p className="text-xs text-muted-foreground">
                {state.pat.expired
                  ? "Refresh to get a new key. Anything using this one has stopped working."
                  : state.pat.expiresAt
                    ? `Expires ${timeUntil(state.pat.expiresAt) ?? "soon"}`
                    : "Never expires"}
              </p>
            </div>
            <div className="space-y-1.5">
              <SettingsLabel>Refreshed key expires</SettingsLabel>
              <SegmentedControl
                ariaLabel="Key expiry"
                options={PAT_EXPIRY_OPTIONS}
                value={expiry}
                onChange={setExpiry}
                size="sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={refresh} disabled={busy} size="lg" variant="outline" className="px-3">
                Refresh
              </Button>
              {/* E4: destructive is danger text, no fill. */}
              <Button
                onClick={revoke}
                disabled={busy}
                size="lg"
                variant="ghost"
                className="px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Revoke
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </SettingsPanel>

      <Dialog open={!!revealToken} onOpenChange={(open) => !open && closeReveal()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your API key</DialogTitle>
            <DialogDescription>
              Copy it now. For your security, it will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <code className="flex-1 min-w-0 truncate text-xs font-mono">{revealToken}</code>
            <Button size="icon-sm" variant="ghost" onClick={copyToken}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReveal}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
