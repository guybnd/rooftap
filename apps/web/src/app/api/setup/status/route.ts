import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated: reveals only whether any account exists at all
// (never which accounts), so the welcome screen and login page know whether
// to show first-run onboarding. Only createAdminClient() can read auth.users.
export async function GET() {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;
    return NextResponse.json({ needsFirstUser: data.users.length === 0 });
  } catch (err) {
    console.error("setup/status GET failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
