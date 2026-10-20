import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, MCP_SCOPE, parseRegistration, saveClient } from "@/lib/mcp-oauth";

// RFC 7591 dynamic client registration. Open by design: registering only
// records an app's name and return addresses; nothing is reachable until a
// signed-in person approves it on /oauth/authorize.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parseRegistration(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, error_description: parsed.description }, { status: 400, headers: CORS_HEADERS });
  }
  if (!(await saveClient(createAdminClient(), parsed.client))) {
    return Response.json({ error: "server_error" }, { status: 500, headers: CORS_HEADERS });
  }
  const { client } = parsed;
  return Response.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.client_name ?? undefined,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_SCOPE,
    },
    { status: 201, headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
