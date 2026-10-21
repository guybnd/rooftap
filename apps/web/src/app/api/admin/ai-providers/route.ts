import { NextResponse } from "next/server";
import {
  AI_CATALOG,
  AI_PROVIDER_ORDER,
  AI_SETTINGS_KEY,
  allAiModels,
  cleanAiServerSettings,
  customProviderKeyName,
  isBuiltInProvider,
  type AiProvidersStatus,
} from "@homeup/core";
import { requireServerOperator } from "@/lib/admin-auth";
import { getAdminConfigValue, loadAiServerSettings, resolveServerKey, setAdminConfigValue } from "@/lib/admin-config";
import { usable } from "@/lib/assistant/provider";

// Settings > AI providers: the server operator's keys, custom providers,
// the models households may pick and the model for each job (core
// ai-providers.ts). Server-global, so gated like admin/keys: operators only.

async function status(): Promise<AiProvidersStatus> {
  const settings = await loadAiServerSettings();
  const builtIn = await Promise.all(
    AI_PROVIDER_ORDER.map(async (id) => {
      const p = AI_CATALOG[id];
      return { id, label: p.label, builtIn: true, keyName: p.keyName, keyUrl: p.keyUrl, baseURL: null, isSet: !!(await usable(resolveServerKey, p.keyName)) };
    })
  );
  const custom = await Promise.all(
    settings.custom.map(async (c) => {
      const keyName = customProviderKeyName(c.id);
      return { id: c.id, label: c.label, builtIn: false, keyName, keyUrl: null, baseURL: c.baseURL, isSet: !!(await getAdminConfigValue(keyName))?.trim() };
    })
  );
  return { settings, providers: [...builtIn, ...custom], models: allAiModels(settings) };
}

export async function GET() {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;
  return NextResponse.json(await status());
}

/**
 * Body: `{ settings }` to replace the AI settings (anything invalid is
 * dropped), or `{ key: { provider, value } }` to store a provider's key.
 * A custom provider's key may be cleared with an empty value.
 */
export async function PUT(request: Request) {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;
  const body = (await request.json().catch(() => null)) as { settings?: unknown; key?: { provider?: unknown; value?: unknown } } | null;
  if (!body) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  try {
    if (body.settings !== undefined) {
      const before = await loadAiServerSettings();
      const next = cleanAiServerSettings(body.settings);
      await setAdminConfigValue(AI_SETTINGS_KEY, JSON.stringify(next));
      // A removed custom provider's key goes with it.
      for (const gone of before.custom.filter((c) => !next.custom.some((n) => n.id === c.id))) {
        await setAdminConfigValue(customProviderKeyName(gone.id), "");
      }
    }
    if (body.key) {
      const provider = typeof body.key.provider === "string" ? body.key.provider : "";
      const value = typeof body.key.value === "string" ? body.key.value.trim() : "";
      if (isBuiltInProvider(provider)) {
        if (!value) return NextResponse.json({ error: "Paste a key first" }, { status: 400 });
        await setAdminConfigValue(AI_CATALOG[provider].keyName, value);
      } else {
        const settings = await loadAiServerSettings();
        if (!settings.custom.some((c) => c.id === provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
        await setAdminConfigValue(customProviderKeyName(provider), value);
      }
    }
  } catch (err) {
    console.error("[admin/ai-providers] save failed", err);
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The server couldn't save that: ${reason}` }, { status: 500 });
  }
  return NextResponse.json(await status());
}
