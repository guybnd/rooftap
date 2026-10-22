"use client";

// Up Bank connector: Settings > Connectors > Up Bank. Each person connects their own
// Up account with a personal access token from api.up.com.au, and chooses
// whether the household sees their spending. The token never comes back from
// the server, only its last four characters. Disconnecting removes every
// transaction read from Up. One primary action (PC).
// Native twin: apps/mobile/src/features/settings/panels/up-bank-settings.tsx.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { timeAgo, useModules, type UpBankStatus } from "@homeup/core";
import { upBankApi } from "@/lib/up-bank-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

const SETUP_HELP =
  "Make a personal access token at api.up.com.au and paste it here. Rooftap reads your transactions and never moves money.";
const OLD_SERVER = "Your Rooftap server needs an update before it can connect Up Bank.";
const NOT_ALLOWED =
  "Up allows its API for personal use only, so Up Bank works on self-hosted Rooftap servers, where your token stays on your own server.";

export function UpBankSettings() {
  const supported = useModules().server("connectors.up-bank");
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
            <SettingsSwitchRow
              title="Share with the household"
              description="Others in your home see your spending, and the assistant can use it when they ask."
              checked={connection.shared}
              disabled={!status.allowed}
              onChange={(on) => void setShared(on)}
            />
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
