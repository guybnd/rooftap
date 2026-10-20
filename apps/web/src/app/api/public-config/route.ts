import { NextResponse } from "next/server";
import { parseModuleList } from "@homeup/core";

// HOUP-69: runtime server-config endpoint for the native app's first-run
// server picker (Official vs self-host). Deliberately reads a plain runtime
// var, NOT `NEXT_PUBLIC_SUPABASE_URL` — Next.js inlines every
// `NEXT_PUBLIC_*` value into the JS bundle at `next build`, so a route that
// only echoed that var could never be reconfigured in a prebuilt self-host
// image. `SUPABASE_PUBLIC_URL` is a real runtime var already wired into
// `API_EXTERNAL_URL` (docker-compose.yml); official/Vercel deployments leave
// it unset and fall back to `NEXT_PUBLIC_SUPABASE_URL`, which is already the
// correct public hosted URL there. The anon key is public by design
// (RLS-gated), so it's fine to both inline it for web and serve it here.
//
// Unauthenticated on purpose (allowlisted in middleware.ts) — the app has no
// session yet when it calls this to discover which server it's talking to.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_PUBLIC_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server is not configured" },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  // Modules this server offers (.docs/modules.md). A runtime var like
  // SUPABASE_PUBLIC_URL, so a prebuilt self-host image can be reconfigured.
  // null = every module.
  const modules = parseModuleList(process.env.HOMEUP_MODULES);
  // The newest migration this build shipped with (baked in by next.config.ts),
  // so the store app can hide features this server is too old for
  // (packages/core/src/server-features.ts).
  const schemaVersion = process.env.HOMEUP_SCHEMA_VERSION || null;

  return NextResponse.json(
    { supabaseUrl, supabaseAnonKey, modules, schemaVersion },
    {
      headers: {
        ...CORS_HEADERS,
        // Short cache — value only changes on a redeploy/reconfigure, but
        // pickers should notice a corrected value within a few minutes.
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
