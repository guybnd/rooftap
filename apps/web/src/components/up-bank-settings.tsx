"use client";

// Up Bank connector: Settings > Connectors > Up Bank. Each person connects their own
// Up account with a personal access token from api.up.com.au, and chooses
// what the household sees: nothing, only their joint accounts, or everything. The token never comes back from
// the server, only its last four characters. Disconnecting removes every
// transaction read from Up. One primary action (PC).
// Native twin: apps/mobile/src/features/settings/panels/up-bank-settings.tsx.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { timeAgo, useModules, type BankShareMode, type UpBankStatus } from "@homeup/core";
import { upBankApi } from "@/lib/up-bank-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsChoiceRow, SettingsInset, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

const SETUP_HELP =
  "Make a personal access token at api.up.com.au and paste it here. Rooftap reads your transactions and never moves money.";
const OLD_SERVER = "Your Rooftap server needs an update before it can connect Up Bank.";
const NOT_ALLOWED =
  "Up allows its API for personal use only, so Up Bank works on self-hosted Rooftap servers, where your token stays on your own server.";

const AUTO_COSTS_HELP =
  "Each payee in your joint accounts gets a cost line, and new payments land on it. Move a line to another category and later payments follow it.";

const SHARE_CHOICES: { mode: BankShareMode; title: string; description: string }[] = [
  { mode: "joint", title: "Share joint accounts", description: "The household sees your 2Up accounts. Your own accounts stay under Mine." },
  { mode: "all", title: "Share everything", description: "The household sees all your Up accounts." },
  { mode: "none", title: "Keep it to myself", description: "Only you see your Up money." },
];

export function UpBankSettings() {
  const modules = useModules();
  const supported = modules.server("connectors.up-bank");
  // Older servers only know on or off.
  const modes = modules.server("connectors.up-bank-sharing");
  const autoFiling = modules.server("connectors.up-bank-auto");
  const [status, setStatus] = useState<UpBankStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    upBankApi.status().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    if (supported) load();
  }, [supported, load]);

  const connection = status?.connection ?? null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await upBankApi.save({ token }));
      setEditing(false);
      setToken("");
      toast.success(connection ? "Up token updated" : "Up connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  };

  const setShared = async (shared: boolean) => {
    if (!status?.connection) return;
    const before = status;
    setStatus({ ...status, connection: { ...status.connection, shared } });
    try {
      setStatus(await upBankApi.save({ shared }));
    } catch (err) {
      setStatus(before);
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const setShareMode = async (shareMode: BankShareMode) => {
    if (!status?.connection) return;
    const before = status;
    setStatus({ ...status, connection: { ...status.connection, shareMode, shared: shareMode !== "none" } });
    try {
      setStatus(await upBankApi.save({ shareMode }));
    } catch (err) {
      setStatus(before);
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const setAutoCosts = async (autoCosts: boolean) => {
    if (!status?.connection) return;
    const before = status;
    setStatus({ ...status, connection: { ...status.connection, autoCosts } });
    try {
      setStatus(await upBankApi.save({ autoCosts }));
      if (autoCosts) toast.success("Joint payments are being filed in Costs");
    } catch (err) {
      setStatus(before);
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await upBankApi.disconnect();
      setStatus((s) => (s ? { ...s, connection: null } : s));
      toast.message("Up disconnected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return <SettingsPanel icon={Landmark} title="Up Bank" description={OLD_SERVER} />;
  }
  if (!status) return null;
  const showForm = status.allowed && status.canStore && (!connection || editing);
  const synced = timeAgo(connection?.lastSyncedAt);

  return (
    <SettingsPanel
      icon={Landmark}
      title="Up Bank"
      description={
        !status.allowed
          ? NOT_ALLOWED
          : connection
            ? "Your Up spending shows in Costs, and the assistant can answer questions about it. Disconnecting removes the transactions Rooftap read from Up."
            : SETUP_HELP
      }
    >
      <div className="space-y-3">
        {connection && (
          <SettingsInset>
            <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">Connected</p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  Token ending {connection.last4} · {connection.live ? "live" : synced ? `read ${synced.toLowerCase()}` : "not read yet"}
                </p>
              </div>
              {status.allowed && !editing && (
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
                  Change
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            {modes ? (
              SHARE_CHOICES.map((c) => (
                <SettingsChoiceRow
                  key={c.mode}
                  selected={(connection.shareMode ?? (connection.shared ? "all" : "none")) === c.mode}
                  onSelect={() => void setShareMode(c.mode)}
                  title={c.title}
                  description={c.description}
                  disabled={!status.allowed}
                />
              ))
            ) : (
              <SettingsSwitchRow
                title="Share with the household"
                description="Others in your home see your spending, and the assistant can use it when they ask."
                checked={connection.shared}
                disabled={!status.allowed}
                onChange={(on) => void setShared(on)}
              />
            )}
            {autoFiling && modes && connection.autoCosts !== undefined && (
              <SettingsSwitchRow
                title="File joint payments as costs"
                description={AUTO_COSTS_HELP}
                checked={connection.autoCosts}
                disabled={!status.allowed || (connection.shareMode ?? "none") === "none"}
                onChange={(on) => void setAutoCosts(on)}
              />
            )}
          </SettingsInset>
        )}

        {showForm && (
          <div className="space-y-2">
            <Input
              type="password"
              aria-label="Up personal access token"
              placeholder={connection ? "New token" : "up:yeah:…"}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
            />
            {connection && <p className="px-1 text-xs text-muted-foreground">{SETUP_HELP}</p>}
            <div className="flex gap-2">
              <Button disabled={busy || !token.trim()} onClick={() => void connect()}>
                {busy ? "Connecting…" : connection ? "Save" : "Connect"}
              </Button>
              {editing && (
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
        {status.allowed && !status.canStore && !connection && (
          <p className="text-xs text-muted-foreground">This server isn&apos;t set up to store tokens yet (HOUSEHOLD_KEYS_SECRET).</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </SettingsPanel>
  );
}
