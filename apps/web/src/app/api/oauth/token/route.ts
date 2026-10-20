import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, exchangeAuthorizationCode, refreshAccessToken } from "@/lib/mcp-oauth";

const NO_STORE = { ...CORS_HEADERS, "cache-control": "no-store" };

// The spec says form-encoded; some clients send JSON, so take either.
async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body ?? {})) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await req.text());
}

export async function POST(req: Request) {
  const params = await readParams(req);
  const grantType = params.get("grant_type");
  const admin = createAdminClient();

  const result =
    grantType === "authorization_code"
      ? await exchangeAuthorizationCode(admin, params)
      : grantType === "refresh_token"
        ? await refreshAccessToken(admin, params)
        : ({ ok: false, error: "unsupported_grant_type", description: "Use authorization_code or refresh_token." } as const);

  if (!result.ok) {
    return Response.json({ error: result.error, error_description: result.description }, { status: 400, headers: NO_STORE });
  }
  return Response.json(result.body, { headers: NO_STORE });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
