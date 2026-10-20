import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session";

// HOUP-154: persist / remove a native device's Expo push token. Sibling to
// apps/web/src/app/api/push/subscribe/route.ts (Web Push) — separate table
// (device_push_tokens) and shape, same group-lookup + service-role upsert
// pattern. Auth goes through the shared, Bearer-capable getSessionUser
// (native has no cookie jar for this origin and sends `Authorization: Bearer
// <token>` instead — the inline cookie-only helper in subscribe/route.ts
// would 401 every mobile call).

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// POST: upsert the device token for the current user (keyed on the token itself).
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const expoPushToken: string | undefined = body?.expoPushToken;
    const platform: string | undefined = body?.platform;
    const deviceId: string | undefined = body?.deviceId;
    if (!expoPushToken || (platform !== "android" && platform !== "ios")) {
      return NextResponse.json({ error: "Invalid device token" }, { status: 400 });
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
      .from("device_push_tokens")
      .upsert(
        {
          user_id: user.id,
          group_id: membership.group_id,
          expo_push_token: expoPushToken,
          platform,
          device_id: deviceId ?? null,
        },
        { onConflict: "expo_push_token" }
      );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push/device-token POST failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE: remove the device token by token for the current user.
export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const expoPushToken: string | undefined = body?.expoPushToken;
    if (!expoPushToken) {
      return NextResponse.json({ error: "Missing expoPushToken" }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin
      .from("device_push_tokens")
      .delete()
      .eq("expo_push_token", expoPushToken)
      .eq("user_id", user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push/device-token DELETE failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
