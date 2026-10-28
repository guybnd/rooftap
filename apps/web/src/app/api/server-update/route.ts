import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasServerOperators, isServerOperator } from "@/lib/admin-auth";
import { serverUpdate } from "@/lib/server-update";

// Whether a newer Rooftap release is out for this server (core
// app-release.ts). Only the people who can upgrade the server hear it: its
// operators (SERVER_OPERATOR_EMAILS), or, on a server that names none, the
// household owners. Everyone else gets { update: null } and the server asks
// GitHub nothing on their behalf.

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin = isServerOperator(user);
  if (!admin && !hasServerOperators()) {
    const { count } = await createAdminClient()
      .from("group_members")
      .select("group_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("role", "owner");
    admin = (count ?? 0) > 0;
  }
  if (!admin) return NextResponse.json({ update: null });

  return NextResponse.json({ update: await serverUpdate() }, { headers: { "Cache-Control": "private, max-age=300" } });
}
