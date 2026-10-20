import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const bypassAllowed =
    process.env.NODE_ENV !== "production" || process.env.ALLOW_AUTH_BYPASS === "true";
  if (!bypassAllowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expectedUsername = process.env.BYPASS_USERNAME;
  const expectedPassword = process.env.BYPASS_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return NextResponse.json(
      { error: "Bypass login is not configured on this server" },
      { status: 503 }
    );
  }

  const { username, password } = await request.json();

  if (username !== expectedUsername || password !== expectedPassword) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const bypassEmail = `${expectedUsername}@homeup.local`;

  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  let userId: string;

  const existing = existingUsers?.users?.find((u) => u.email === bypassEmail);
  if (existing) {
    userId = existing.id;
  } else {
    const { data: newUser, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: bypassEmail,
        password: expectedPassword,
        email_confirm: true,
        user_metadata: { name: "Dev Admin", bypass: true },
      });
    if (createError || !newUser.user) {
      return NextResponse.json({ error: "Failed to create bypass user" }, { status: 500 });
    }
    userId = newUser.user.id;
  }

  const { data: linkData, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: bypassEmail,
    });

  if (linkError || !linkData) {
    return NextResponse.json({ error: "Failed to generate session" }, { status: 500 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const linkUrl = new URL(linkData.properties.action_link);
  const token_hash = linkUrl.searchParams.get("token_hash") ?? linkUrl.searchParams.get("token");
  if (!token_hash) {
    return NextResponse.json({ error: "Failed to extract token" }, { status: 500 });
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash,
    type: "magiclink",
  });

  if (verifyError) {
    return NextResponse.json({ error: "Session creation failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, redirect: "/" });
}
