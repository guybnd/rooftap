import { CORS_HEADERS } from "@/lib/mcp-oauth";

// Rooftap is not an OpenID provider. Some MCP clients try this path next to the
// OAuth metadata and take the first success, so a login page here breaks their
// discovery. Say so plainly.
export function GET() {
  return Response.json({ error: "not_found" }, { status: 404, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
