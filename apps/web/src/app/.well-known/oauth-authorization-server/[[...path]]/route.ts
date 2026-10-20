import { CORS_HEADERS, authorizationServerMetadata } from "@/lib/mcp-oauth";

// RFC 8414 authorization server metadata for MCP sign-in.
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  return Response.json(authorizationServerMetadata(origin), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
