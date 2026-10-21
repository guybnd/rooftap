"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AI_CATALOG, type TestResult } from '@homeup/core';
import { hasAiProvidersPanel } from "@/components/ai-providers-settings";

// The AI providers panel owns the AI keys and the parsing provider on servers that have it.
const AI_KEY_NAMES = new Set(Object.values(AI_CATALOG).map((p) => p.keyName));

interface KeyStatus {
  key: string;
  class: "runtime" | "build-time";
  label: string;
  purpose: string;
  isSet: boolean;
}

// HOUP-43: owner-facing setting for which provider handles all parsing.
type ParsingProviderId = "openai" | "openrouter" | "gemini" | "anthropic";

interface ParsingProviderStatus {
  id: ParsingProviderId;
  label: string;
  keyName: string;
  isSet: boolean;
}

// H2: a key's state is a small dose of status: a dot and a word, never a
// tinted pill. "Not set" is resting silence, so it stays muted.
function StatusWord({ tone, label }: { tone: "success" | "warning" | "destructive" | "muted"; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "destructive" && "text-destructive",
        tone === "muted" && "text-muted-foreground"
      )}
    >
      {tone !== "muted" && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

// HOUP-46: renders the last Test result for a key, falling back to the plain
// Set/Not set word until a test has been run (or if the server reports the
// key isn't resolvable, per POST /api/admin/keys/test's "unsupported" status).
const RESULT_TONE: Record<Exclude<TestResult["status"], "unsupported">, "success" | "warning" | "destructive"> = {
  valid: "success",
  invalid: "destructive",
  "no-credit": "warning",
  unreachable: "warning",
};
const RESULT_LABEL: Record<Exclude<TestResult["status"], "unsupported">, string> = {
  valid: "Valid",
  invalid: "Invalid",
  "no-credit": "No credit",
  unreachable: "Unreachable",
};

function ResultChip({ result, isSet }: { result: TestResult | undefined; isSet: boolean }) {
  if (!result || result.status === "unsupported") {
    return isSet ? <StatusWord tone="success" label="Set" /> : <StatusWord tone="muted" label="Not set" />;
  }
  return <StatusWord tone={RESULT_TONE[result.status]} label={RESULT_LABEL[result.status]} />;
}

// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are one logical row (a single
// OAuth pair) in the GET status response, but each is a distinct PUT target.
const GOOGLE_FIELDS = [
  { key: "GOOGLE_CLIENT_ID", fieldLabel: "Client ID" },
  { key: "GOOGLE_CLIENT_SECRET", fieldLabel: "Client secret" },
];

export function ApiKeysSettings() {
  // HOUP-242: operator status is server-env-only (SERVER_OPERATOR_EMAILS),
  // so it can't be derived client-side — isGroupOwner used to gate this
  // panel, but a group owner is no longer guaranteed to be a server
  // operator. Instead treat a 403 from the GET this panel already performs
  // as "not an operator" (null = not yet known, hide nothing extra; the
  // existing `!keys` loading state covers the wait).
  const [isOperator, setIsOperator] = useState<boolean | null>(null);
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed save shows under its own row, where the person is looking.
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const [parsingProvider, setParsingProvider] = useState<ParsingProviderId | "">("");
  const [providerStatuses, setProviderStatuses] = useState<ParsingProviderStatus[] | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [aiPanel, setAiPanel] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/keys");
      if (res.status === 403) {
        setIsOperator(false);
        return;
      }
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setIsOperator(true);
      const data = await res.json();
      setKeys(data.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load key status.");
    }
  }, []);

  const loadParsingProvider = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/parsing-provider");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setParsingProvider(data.provider ?? "");
      setProviderStatuses(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load parsing provider.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isOperator) return;
    void hasAiProvidersPanel().then((has) => {
      setAiPanel(has);
      if (!has) loadParsingProvider();
    });
  }, [isOperator, loadParsingProvider]);

  const saveParsingProvider = useCallback(async (provider: ParsingProviderId | "") => {
    setError(null);
    setProviderBusy(true);
    const previous = parsingProvider;
    setParsingProvider(provider);
    try {
      const res = await fetch("/api/admin/parsing-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
      toast.success("Parsing provider updated");
    } catch (err) {
      setParsingProvider(previous);
      setError(err instanceof Error ? err.message : "Could not update parsing provider.");
    } finally {
      setProviderBusy(false);
    }
  }, [parsingProvider]);

  const save = useCallback(
    async (key: string) => {
      const value = drafts[key]?.trim();
      if (!value) return;
      setError(null);
      setSaveError(null);
      setBusyKey(key);
      try {
        const res = await fetch("/api/admin/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Server responded ${res.status}`);
        setDrafts((prev) => ({ ...prev, [key]: "" }));
        toast.success("Key saved");
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not save key.";
        setSaveError({ key, message });
        toast.error("Key not saved", { description: message });
      } finally {
        setBusyKey(null);
      }
    },
    [drafts, load]
  );

  // Tests are user-initiated only -- never on panel load or per-request, to
  // stay well under the tightest per-provider rate limit (Mapbox Tokens API,
  // 100 req/min/account).
  const testKey = useCallback(async (key: string) => {
    setTestingKey(key);
    try {
      const res = await fetch("/api/admin/keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data: TestResult = await res.json();
      setTestResults((prev) => ({ ...prev, [key]: data }));
    } catch {
      setTestResults((prev) => ({ ...prev, [key]: { status: "unreachable" } }));
    } finally {
      setTestingKey(null);
    }
  }, []);

  // Only a confirmed operator sees the panel, so nobody else glimpses it while it loads.
  if (isOperator !== true) return null;

  const runtimeKeys = keys?.filter((k) => k.class === "runtime" && !(aiPanel && AI_KEY_NAMES.has(k.key))) ?? [];
  const buildTimeKeys = keys?.filter((k) => k.class === "build-time") ?? [];

  return (
    <SettingsPanel
      icon={KeyRound}
      title="API keys"
      description="Third-party keys for the whole server, shared by every household on it. Only server operators see this. A saved key works from the next request, no restart needed."
    >

        {providerStatuses && !aiPanel && (
          <div className="space-y-2">
            <SettingsLabel id="parsing-provider-label">Parsing provider</SettingsLabel>
            {/* Five choices overflow a segmented control at phone width, so
                this is the app's pick-one list, which also has room to say
                whether each provider's key is set. */}
            <SettingsInset
              role="radiogroup"
              aria-labelledby="parsing-provider-label"
              className={providerBusy ? "opacity-60" : undefined}
            >
              <SettingsChoiceRow
                selected={parsingProvider === ""}
                onSelect={() => saveParsingProvider("")}
                disabled={providerBusy}
                title="Default"
                description="OpenAI for listings and receipts, Gemini for recipes"
              />
              {providerStatuses.map((p) => (
                <SettingsChoiceRow
                  key={p.id}
                  selected={parsingProvider === p.id}
                  onSelect={() => saveParsingProvider(p.id)}
                  disabled={providerBusy}
                  title={p.label}
                  description={p.isSet ? "Key set" : "No key yet"}
                />
              ))}
            </SettingsInset>
            {parsingProvider && !providerStatuses.find((p) => p.id === parsingProvider)?.isSet && (
              <p className="px-1 text-xs text-destructive">
                {providerStatuses.find((p) => p.id === parsingProvider)?.label} has no key yet. Parsing
                fails until you add one below.
              </p>
            )}
          </div>
        )}

        {!keys && <p className="text-sm text-muted-foreground">Loading…</p>}

        {keys && (
          <SettingsInset>
            {runtimeKeys.map((status) => (
              <div key={status.key} className="space-y-2 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{status.label}</p>
                    <p className="text-xs text-muted-foreground">{status.purpose}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ResultChip result={testResults[status.key]} isSet={status.isSet} />
                    <Button
                      size="lg"
                      variant="ghost"
                      onClick={() => testKey(status.key)}
                      disabled={testingKey === status.key}
                    >
                      {testingKey === status.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>

                {status.key === "GOOGLE_CLIENT_ID" ? (
                  <div className="space-y-2">
                    {GOOGLE_FIELDS.map((field) => (
                      <div key={field.key} className="flex items-center gap-2">
                        <Input
                          type="password"
                          className="h-9"
                          aria-label={field.fieldLabel}
                          placeholder={field.fieldLabel}
                          value={drafts[field.key] ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          disabled={busyKey === field.key}
                        />
                        <Button
                          size="lg"
                          variant={drafts[field.key]?.trim() ? "default" : "outline"}
                          onClick={() => save(field.key)}
                          disabled={busyKey === field.key || !drafts[field.key]?.trim()}
                        >
                          Save
                        </Button>
                      </div>
                    ))}
                    {saveError && GOOGLE_FIELDS.some((f) => f.key === saveError.key) && (
                      <p className="text-xs text-destructive">{saveError.message}</p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      className="h-9"
                      aria-label={`New ${status.label}`}
                      placeholder="New value"
                      value={drafts[status.key] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [status.key]: e.target.value }))}
                      disabled={busyKey === status.key}
                    />
                    <Button
                      size="lg"
                      variant={drafts[status.key]?.trim() ? "default" : "outline"}
                      onClick={() => save(status.key)}
                      disabled={busyKey === status.key || !drafts[status.key]?.trim()}
                    >
                      Save
                    </Button>
                  </div>
                )}
                {saveError?.key === status.key && <p className="text-xs text-destructive">{saveError.message}</p>}
              </div>
            ))}
          </SettingsInset>
        )}

        {keys && buildTimeKeys.length > 0 && (
          <div className="space-y-2">
            <SettingsLabel>Build-time keys</SettingsLabel>
            <SettingsInset>
              {buildTimeKeys.map((status) => (
                <div key={status.key} className="flex items-center justify-between gap-2 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{status.label}</p>
                    <p className="text-xs text-muted-foreground">{status.purpose}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ResultChip result={testResults[status.key]} isSet={status.isSet} />
                    <Button
                      size="lg"
                      variant="ghost"
                      onClick={() => testKey(status.key)}
                      disabled={testingKey === status.key}
                    >
                      {testingKey === status.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
              ))}
            </SettingsInset>
            <p className="px-1 text-xs text-muted-foreground">
              Baked into the app when it&apos;s built, so changing one needs a rebuild.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
    </SettingsPanel>
  );
}
