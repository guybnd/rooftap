import { NextResponse } from "next/server";
import { requireServerOperator } from "@/lib/admin-auth";
import { resolveServerKey } from "@/lib/admin-config";
import { KEY_VALIDATORS, testGoogleOAuthPair, type TestResult } from '@homeup/core';
import { RUNTIME_KEY_NAMES, BUILD_TIME_KEY_NAMES } from "@/lib/admin-keys";

// HOUP-46/HOUP-242: server-operator-only, on-demand key test — this config
// is server-global, so the gate is requireServerOperator(), not group
// ownership. Resolves through resolveServerKey (the DB-then-env order in
// src/lib/admin-config.ts) so a stale admin_config row is exercised exactly
// like a real request would see it (C2) — this is the point of the feature
// (FLUX-283: a stale stored key silently shadowing a corrected .env.local).
// Never echoes key material back in the response (C3).

const NOT_SET: TestResult = { status: "unsupported", detail: "Not set" };

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireServerOperator();
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => null);
  const key: string | undefined = body?.key;

  if (!key || (!RUNTIME_KEY_NAMES.has(key) && !BUILD_TIME_KEY_NAMES.has(key))) {
    return NextResponse.json({ error: "Unknown key" }, { status: 400 });
  }

  if (key === "GOOGLE_CLIENT_ID") {
    const [clientId, clientSecret] = await Promise.all([
      resolveServerKey("GOOGLE_CLIENT_ID"),
      resolveServerKey("GOOGLE_CLIENT_SECRET"),
    ]);
    if (!clientId || !clientSecret) return NextResponse.json(NOT_SET);
    const result = await testGoogleOAuthPair(clientId, clientSecret);
    return NextResponse.json(result);
  }

  const value = await resolveServerKey(key);
  if (!value) return NextResponse.json(NOT_SET);

  const validator = KEY_VALIDATORS[key];
  if (!validator) return NextResponse.json({ status: "unsupported" } satisfies TestResult);

  const result = await validator(value);
  return NextResponse.json(result);
}
