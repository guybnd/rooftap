import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session";
import { isServerAdmin } from "@/lib/admin-auth";
import { serverUpdate } from "@/lib/server-update";
import { readServerUpdater } from "@/lib/server-updater";

// Whether a newer Rooftap release is out for this server (core
// app-release.ts), and how a one-click update is going (core
// server-updater.ts). Only the people who can upgrade the server hear it:
// its operators (SERVER_OPERATOR_EMAILS), or, on a server that names none,
// the household owners. Everyone else gets { update: null, updater: null }
// and the server asks GitHub nothing on their behalf.

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isServerAdmin(user))) return NextResponse.json({ update: null, updater: null });

  const [update, updater] = await Promise.all([serverUpdate(), readServerUpdater()]);
  // No caching: an open panel asks every few seconds while an update runs.
  return NextResponse.json({ update, updater }, { headers: { "Cache-Control": "private, no-store" } });
}
