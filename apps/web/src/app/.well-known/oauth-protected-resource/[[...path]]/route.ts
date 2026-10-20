import { CORS_HEADERS, protectedResourceMetadata } from "@/lib/mcp-oauth";

// RFC 9728 protected resource metadata for /api/mcp. Clients may ask at the
// bare path or with the resource path appended, so both answer the same.
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  return Response.json(protectedResourceMetadata(origin), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
