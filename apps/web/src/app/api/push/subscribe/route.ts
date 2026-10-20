import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// FLUX-128: persist / remove a browser's Web Push subscription.
// A cookie-scoped client authenticates the caller, then a service-role admin
// client writes the row.

async function getSessionUser() {
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
  // getUser() validates the token with the Auth server; getSession() only reads
  // the cookie and is not trustworthy server-side.
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// A push endpoint is later POSTed to verbatim by the service-role Edge Function, so
// constrain it to a plain https:// URL to avoid a stored-SSRF vector (e.g. internal
// hosts). Real push services (FCM, Mozilla, WNS) are all https.
function isValidEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

// POST: upsert the subscription for the current user (keyed on endpoint).
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const sub = body?.subscription ?? body;
    const endpoint: string | undefined = sub?.endpoint;
    const p256dh: string | undefined = sub?.keys?.p256dh;
    const auth: string | undefined = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth || !isValidEndpoint(endpoint)) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const admin = adminClient();
    const { data: membership } = await admin
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!membership) {
      return NextResponse.json({ error: "No group" }, { status: 400 });
    }

    const { error } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          group_id: membership.group_id,
          endpoint,
          p256dh,
          auth,
          user_agent: request.headers.get("user-agent") ?? null,
        },
        { onConflict: "endpoint" }
      );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push/subscribe POST failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE: remove the subscription by endpoint for the current user.
export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const endpoint: string | undefined = body?.endpoint ?? body?.subscription?.endpoint;
    if (!endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push/subscribe DELETE failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
