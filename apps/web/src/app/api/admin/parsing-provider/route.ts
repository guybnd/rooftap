import { NextResponse } from "next/server";
import { requireServerOperator } from "@/lib/admin-auth";
import { getAdminConfigValue, setAdminConfigValue } from "@/lib/admin-config";

// HOUP-43/HOUP-242: server-operator-only setting for which AI provider
// handles all parsing (listing/receipt/recipe) — server-global, so the gate
// is requireServerOperator(), not group ownership. Mirrors keys/route.ts's
// gate.

interface ProviderDefinition {
  id: string;
  label: string;
  keyName: string;
}

const PROVIDERS: ProviderDefinition[] = [
  { id: "openai", label: "OpenAI", keyName: "OPENAI_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyName: "OPENROUTER_API_KEY" },
  { id: "gemini", label: "Gemini", keyName: "GEMINI_API_KEY" },
  { id: "anthropic", label: "Anthropic", keyName: "ANTHROPIC_API_KEY" },
];

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

export async function GET() {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;

  const provider = (await getAdminConfigValue("AI_PARSING_PROVIDER")) ?? "";

  const providers = await Promise.all(
    PROVIDERS.map(async (def) => {
      const stored = await getAdminConfigValue(def.keyName);
      const isSet = Boolean(stored ?? process.env[def.keyName]);
      return { id: def.id, label: def.label, keyName: def.keyName, isSet };
    })
  );

  return NextResponse.json({ provider, providers });
}

export async function PUT(request: Request) {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => null);
  const provider: string | undefined = body?.provider;

  // "" clears back to the no-regression default (legacy per-type split).
  if (provider !== "" && (!provider || !PROVIDER_IDS.has(provider))) {
    return NextResponse.json({ error: "A valid provider is required" }, { status: 400 });
  }

  await setAdminConfigValue("AI_PARSING_PROVIDER", provider);
  return NextResponse.json({ ok: true });
}
