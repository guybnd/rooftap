"use client";

// Settings > Integrations & keys > AI providers (server operators only): the
// server's AI keys, custom providers (anything that speaks OpenAI's chat
// API), the model for each job, and which models households may pick. The
// rules live in core ai-providers.ts; this panel only edits the settings.
// Native twin: apps/mobile/src/features/settings/panels/ai-providers-settings.tsx.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cpu, Loader2, Plus, Trash2 } from "lucide-react";
import {
  AI_FEATURES,
  aiModelPickerOptions,
  aiModelPriceLine,
  modelsForFeature,
  splitModelIds,
  withCustomProvider,
  withDefault,
  withExtraModel,
  withOfferedAll,
  withOfferedToggled,
  withoutCustomProvider,
  withoutExtraModel,
  type AiProvidersStatus,
  type AiServerSettings,
} from "@homeup/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { SettingsCheckbox, SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";
import { cn } from "@/lib/utils";

async function request(body?: unknown): Promise<AiProvidersStatus> {
  const res = await fetch("/api/admin/ai-providers", {
    method: body ? "PUT" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `Server responded ${res.status}`), { status: res.status });
  return data as AiProvidersStatus;
}

/** Whether this server has the AI providers panel (older ones answer 404), so the API keys panel can step aside. */
export async function hasAiProvidersPanel(): Promise<boolean> {
  try {
    return (await fetch("/api/admin/ai-providers")).ok;
  } catch {
    return false;
  }
}

function StatusWord({ isSet }: { isSet: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", isSet ? "text-success" : "text-muted-foreground")}>
      {isSet && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {isSet ? "Key set" : "No key"}
    </span>
  );
}

export function AiProvidersSettings() {
  const [status, setStatus] = useState<AiProvidersStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ label: "", baseURL: "", key: "", models: "" });
  const [extra, setExtra] = useState<{ provider: string; id: string }>({ provider: "", id: "" });

  useEffect(() => {
    request()
      .then(setStatus)
      .catch((err: { status?: number }) => {
        // 403: not an operator. 404: a server from before this panel.
        if (err.status === 403 || err.status === 404) setHidden(true);
      });
  }, []);

  const saveSettings = useCallback(
    async (next: AiServerSettings, what = "settings") => {
      if (!status) return;
      const before = status;
      setStatus({ ...status, settings: next });
      setBusy(what);
      try {
        setStatus(await request({ settings: next }));
      } catch (err) {
        setStatus(before);
        toast.error(err instanceof Error ? err.message : "Could not save that.");
      } finally {
        setBusy(null);
      }
    },
    [status]
  );

  const saveKey = useCallback(async (provider: string, value: string) => {
    setBusy(`key:${provider}`);
    try {
      setStatus(await request({ key: { provider, value } }));
      setDrafts((d) => ({ ...d, [provider]: "" }));
      toast.success("Key saved");
    } catch (err) {
      toast.error("Key not saved", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }, []);

  const keyed = useMemo(() => new Set(status?.providers.filter((p) => p.isSet || !p.builtIn).map((p) => p.id) ?? []), [status]);
  const ready = useMemo(() => status?.models.filter((m) => keyed.has(m.provider)) ?? [], [status, keyed]);

  if (hidden) return null;
  if (!status) {
    return (
      <SettingsPanel icon={Cpu} title="AI providers" description="Loading…">
        {null}
      </SettingsPanel>
    );
  }
  const { settings } = status;

  const addCustom = async () => {
    const models = splitModelIds(custom.models);
    if (!custom.label.trim() || !/^https?:\/\//i.test(custom.baseURL.trim()) || models.length === 0) {
      toast.error("Add a name, an address starting with http, and at least one model.");
      return;
    }
    const next = withCustomProvider(settings, custom.label, custom.baseURL, models);
    const id = next.custom[next.custom.length - 1].id;
    await saveSettings(next, "custom");
    if (custom.key.trim()) await saveKey(id, custom.key.trim());
    setCustom({ label: "", baseURL: "", key: "", models: "" });
    setAdding(false);
  };

  return (
    <SettingsPanel
      icon={Cpu}
      title="AI providers"
      description="The AI services this server uses, the model for each job, and the models households can choose. Keys work from the next request."
    >
      <div className="space-y-2">
        <SettingsLabel>Providers</SettingsLabel>
        <SettingsInset>
          {status.providers.map((p) => (
            <div key={p.id} className="space-y-2 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.builtIn ? (
                      <a href={p.keyUrl ?? undefined} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                        Get a key
                      </a>
                    ) : (
                      p.baseURL
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusWord isSet={p.isSet} />
                  {!p.builtIn && (
                    <button
                      type="button"
                      aria-label={`Remove ${p.label}`}
                      onClick={() => void saveSettings(withoutCustomProvider(settings, p.id))}
                      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  className="h-9"
                  aria-label={`${p.label} key`}
                  placeholder={p.builtIn ? "Paste a new key" : "Key, if the server needs one"}
                  value={drafts[p.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  disabled={busy === `key:${p.id}`}
                />
                <Button
                  size="lg"
                  variant={drafts[p.id]?.trim() ? "default" : "outline"}
                  disabled={busy === `key:${p.id}` || !drafts[p.id]?.trim()}
                  onClick={() => void saveKey(p.id, drafts[p.id].trim())}
                >
                  {busy === `key:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>
          ))}
        </SettingsInset>

        {adding ? (
          <SettingsInset className="space-y-2 p-3.5">
            <p className="text-sm font-medium">Custom provider</p>
            <p className="text-xs text-muted-foreground">Any server that speaks OpenAI&apos;s chat API, such as Ollama, LM Studio or a company gateway.</p>
            <Input placeholder="Name, e.g. Home Ollama" value={custom.label} onChange={(e) => setCustom((c) => ({ ...c, label: e.target.value }))} />
            <Input placeholder="Address, e.g. http://ollama:11434/v1" value={custom.baseURL} onChange={(e) => setCustom((c) => ({ ...c, baseURL: e.target.value }))} />
            <Input type="password" placeholder="Key (optional)" value={custom.key} onChange={(e) => setCustom((c) => ({ ...c, key: e.target.value }))} />
            <Input placeholder="Models, e.g. qwen3:14b, llama3.1:8b" value={custom.models} onChange={(e) => setCustom((c) => ({ ...c, models: e.target.value }))} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="lg" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="lg" disabled={busy === "custom"} onClick={() => void addCustom()}>
                Add provider
              </Button>
            </div>
          </SettingsInset>
        ) : (
          <Button variant="ghost" size="lg" className="w-full justify-start" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add a custom provider
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <SettingsLabel>Model for each job</SettingsLabel>
        <SettingsInset>
          {AI_FEATURES.map((f) => (
            <div key={f.id} className="space-y-1.5 px-3.5 py-3">
              <p className="text-sm font-medium">{f.label}</p>
              <p className="text-xs text-muted-foreground">{f.hint}</p>
              <SearchablePicker
                ariaLabel={f.label}
                options={aiModelPickerOptions(modelsForFeature(ready, f.id), "Automatic: the first provider with a key")}
                value={settings.defaults[f.id] ?? ""}
                onChange={(ref) => void saveSettings(withDefault(settings, f.id, ref))}
                searchPlaceholder="Search models"
              />
            </div>
          ))}
        </SettingsInset>
      </div>

      <div className="space-y-2">
        <SettingsLabel>What households can choose</SettingsLabel>
        <SettingsInset>
          <SettingsSwitchRow
            title="Any model with a key"
            description="Off: households choose from the models ticked below. A household with its own key can always use that provider's verified models."
            checked={settings.offered === null}
            onChange={(all) => void saveSettings(withOfferedAll(settings, all, ready))}
          />
          {ready.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">Add a key above to see its models.</p>}
          {ready.map((m) => (
            <div key={m.ref} className="flex items-center">
              <SettingsCheckbox
                checked={settings.offered === null || settings.offered.includes(m.ref)}
                disabled={settings.offered === null}
                onChange={() => void saveSettings(withOfferedToggled(settings, m.ref))}
              >
                <span className="font-medium">{m.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {m.providerLabel} · {aiModelPriceLine(m)}
                </span>
              </SettingsCheckbox>
              {!m.verified && (
                <button
                  type="button"
                  aria-label={`Remove ${m.label}`}
                  onClick={() => void saveSettings(withoutExtraModel(settings, m.ref))}
                  className="mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </SettingsInset>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[10rem] flex-1">
            <SearchablePicker
              ariaLabel="Provider for the new model"
              placeholder="Provider"
              options={status.providers.map((p) => ({ value: p.id, primary: p.label }))}
              value={extra.provider || null}
              onChange={(provider) => setExtra((x) => ({ ...x, provider }))}
            />
          </div>
          <Input
            className="min-w-[10rem] flex-1"
            placeholder="Model id"
            value={extra.id}
            onChange={(e) => setExtra((x) => ({ ...x, id: e.target.value.trim() }))}
          />
          <Button
            size="lg"
            variant="outline"
            disabled={!extra.provider || !extra.id}
            onClick={() => {
              void saveSettings(withExtraModel(settings, extra.provider, extra.id));
              setExtra({ provider: extra.provider, id: "" });
            }}
          >
            Add model
          </Button>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Models you add aren&apos;t verified by Rooftap: tool calling may not work, and their spend counts at a cautious estimate unless priced in
          ASSISTANT_MODEL_PRICES.
        </p>
      </div>
    </SettingsPanel>
  );
}
