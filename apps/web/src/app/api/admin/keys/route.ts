import { NextResponse } from "next/server";
import { getAdminConfigValue, setAdminConfigValue } from "@/lib/admin-config";
import { requireServerOperator } from "@/lib/admin-auth";
import { RUNTIME_KEYS, BUILD_TIME_KEYS, RUNTIME_KEY_NAMES, BUILD_TIME_KEY_NAMES } from "@/lib/admin-keys";

// HOUP-25/HOUP-242: server-operator-only status + entry for third-party API
// keys — this config is server-global, not per-group, so the gate is
// requireServerOperator() (src/lib/admin-auth.ts), not group ownership. The
// client panel self-gates on a 403 from GET (cosmetic), but the real
// boundary is this shared gate, which every verb calls before touching data
// — mirrors src/app/api/admin/parsing-provider/route.ts.

export async function GET() {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;

  const runtimeStatus = await Promise.all(
    RUNTIME_KEYS.map(async (def) => {
      if (def.key === "GOOGLE_CLIENT_ID") {
        const [clientId, clientSecret] = await Promise.all([
          getAdminConfigValue("GOOGLE_CLIENT_ID"),
          getAdminConfigValue("GOOGLE_CLIENT_SECRET"),
        ]);
        const isSet =
          Boolean(clientId ?? process.env.GOOGLE_CLIENT_ID) &&
          Boolean(clientSecret ?? process.env.GOOGLE_CLIENT_SECRET);
        return { key: def.key, class: def.class, label: def.label, purpose: def.purpose, isSet };
      }
      const stored = await getAdminConfigValue(def.key);
      const isSet = Boolean(stored ?? process.env[def.key]);
      return { key: def.key, class: def.class, label: def.label, purpose: def.purpose, isSet };
    })
  );

  const buildTimeStatus = BUILD_TIME_KEYS.map((def) => ({
    key: def.key,
    class: def.class,
    label: def.label,
    purpose: def.purpose,
    isSet: Boolean(process.env[def.key]),
  }));

  return NextResponse.json({ keys: [...runtimeStatus, ...buildTimeStatus] });
}

export async function PUT(request: Request) {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => null);
  const key: string | undefined = body?.key;
  const value: string | undefined = body?.value;

  if (!key || typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: "A key and non-empty value are required" }, { status: 400 });
  }

  if (BUILD_TIME_KEY_NAMES.has(key)) {
    return NextResponse.json(
      { error: "This key is inlined at build time and cannot be set from the UI" },
      { status: 400 }
    );
  }

  if (!RUNTIME_KEY_NAMES.has(key)) {
    return NextResponse.json({ error: "Unknown key" }, { status: 400 });
  }

  try {
    await setAdminConfigValue(key, value.trim());
  } catch (err) {
    console.error("[admin/keys] save failed", err);
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The server couldn't store the key: ${reason}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
