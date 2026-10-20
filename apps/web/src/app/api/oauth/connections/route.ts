import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { listConnections, revokeConnection } from "@/lib/mcp-oauth";

// Apps the signed-in user connected to the MCP server by signing in (web and
// native settings panels). Same session rules as /api/pat.

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ connections: await listConnections(createAdminClient(), user.id) });
}

// DELETE /api/oauth/connections?id=<connection id> disconnects one app.
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await revokeConnection(createAdminClient(), user.id, id);
  return NextResponse.json({ ok: true });
}
