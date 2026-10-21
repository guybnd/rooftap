"use client";

// HOUP-436: Settings > Integrations & keys > AI keys. The household's own
// AI keys: with one, receipts, recipes, listings, events and the assistant
// run on it with no monthly limit and nothing charged to the server. Members
// see which providers have a key (last four characters only); owners add and
// remove them. Native twin: apps/mobile/src/features/settings/panels/household-ai-keys.tsx.
import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AI_KEY_PROVIDER_META, AI_KEY_PROVIDERS, aiKeysUsageLine, useModules, type AiKeyProvider, type HouseholdAiKeysStatus } from "@homeup/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsInset, SettingsPanel } from "@/components/settings-panel";

async function call(method: "PUT" | "DELETE", provider: AiKeyProvider, key?: string) {
  const res = await fetch(method === "DELETE" ? `/api/ai-keys?provider=${provider}` : "/api/ai-keys", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "PUT" ? JSON.stringify({ provider, key }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
}

export function HouseholdAiKeys() {
  const modules = useModules();
  const supported = modules.server("ai.household-keys");
  const [status, setStatus] = useState<HouseholdAiKeysStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<AiKeyProvider, string>>>({});
  const [busy, setBusy] = useState<AiKeyProvider | null>(null);
  const [rowError, setRowError] = useState<{ provider: AiKeyProvider; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-keys");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setStatus(await res.json());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);

  const run = async (provider: AiKeyProvider, method: "PUT" | "DELETE") => {
    setBusy(provider);
    setRowError(null);
    try {
      await call(method, provider, drafts[provider]);
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
      toast.success(method === "PUT" ? "Key saved" : "Key removed");
      await load();
    } catch (err) {
      setRowError({ provider, message: err instanceof Error ? err.message : "Could not save that." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsPanel
      icon={Sparkles}
      title="AI keys"
      description="Your household's own AI keys. With one, AI reads and the assistant run on it, with no monthly limit."
    >
      {!supported ? (
        <p className="text-sm text-muted-foreground">Update your server to use your household&apos;s own AI key.</p>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your AI keys. Check your connection and try again.</p>
      ) : !status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground tabular-nums">{aiKeysUsageLine(status)}</p>
          <SettingsInset>
            {AI_KEY_PROVIDERS.map((provider) => {
              const meta = AI_KEY_PROVIDER_META[provider];
              const saved = status.keys.find((k) => k.provider === provider);
              const draft = drafts[provider]?.trim() ?? "";
              return (
                <div key={provider} className="space-y-2 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {saved ? `Key ending ${saved.last4}` : "No key"}
                        {status.isOwner && !saved && (
                          <>
                            {" · "}
                            <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                              Get a key
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    {status.isOwner && saved && (
                      <Button size="lg" variant="ghost" onClick={() => void run(provider, "DELETE")} disabled={busy === provider}>
                        Remove
                      </Button>
                    )}
                  </div>
                  {status.isOwner && status.canStore && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        className="h-9"
                        aria-label={`${meta.label} key`}
                        placeholder={saved ? "Replace key" : "Paste key"}
                        value={drafts[provider] ?? ""}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [provider]: e.target.value }))}
                        disabled={busy === provider}
                      />
                      <Button
                        size="lg"
                        variant={draft ? "default" : "outline"}
                        onClick={() => void run(provider, "PUT")}
                        disabled={busy === provider || !draft}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                  {rowError?.provider === provider && <p className="text-xs text-destructive">{rowError.message}</p>}
                </div>
              );
            })}
          </SettingsInset>
          {status.isOwner && !status.canStore && (
            <p className="text-xs text-muted-foreground">This server isn&apos;t set up to store household keys yet.</p>
          )}
          {!status.isOwner && <p className="text-xs text-muted-foreground">A household owner can add or remove keys.</p>}
        </>
      )}
    </SettingsPanel>
  );
}
