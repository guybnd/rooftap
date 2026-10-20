import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      }
    );

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: membership } = await admin
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (!membership) {
      return NextResponse.json({ members: [] });
    }

    const { data: members } = await admin
      .from("group_members")
      .select("user_id, role")
      .eq("group_id", membership.group_id);

    if (!members?.length) {
      return NextResponse.json({ members: [] });
    }

    const { data: { users } } = await admin.auth.admin.listUsers();
    const userMap: Record<string, { email: string; name: string | null; avatar: string | null }> = {};
    for (const u of users) {
      userMap[u.id] = {
        email: u.email ?? "",
        name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
        avatar: u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null,
      };
    }

    const enriched = members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      email: userMap[m.user_id]?.email ?? null,
      name: userMap[m.user_id]?.name ?? null,
      avatar: userMap[m.user_id]?.avatar ?? null,
    }));

    return NextResponse.json({ members: enriched });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
