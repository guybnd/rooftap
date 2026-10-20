import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// FLUX-157: dedicated "Connect Google Calendar" OAuth callback, separate from
// the main sign-in callback (src/app/(auth)/callback/route.ts) — this flow
// requests Calendar scopes and captures the resulting provider tokens into
// google_calendar_connections. The user is already signed in, so failures
// redirect back to /settings — except an account-mismatch abort (see below),
// which signs the swapped session out and redirects to /login.

const REQUESTED_SCOPES =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.calendars";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const oauthError = searchParams.get("error");
  const oauthErrorDesc = searchParams.get("error_description");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/settings?calendarError=${encodeURIComponent(oauthErrorDesc || oauthError)}`, origin)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL(`/settings?calendarError=${encodeURIComponent("no_code")}`, origin));
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

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error("[calendar-callback] exchangeCodeForSession failed:", exchangeError.message, exchangeError.status);
    return NextResponse.redirect(
      new URL(`/settings?calendarError=${encodeURIComponent(exchangeError.message)}`, origin)
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user || !session.provider_token) {
    console.error("[calendar-callback] no provider_token on session after exchange");
    return NextResponse.redirect(
      new URL(`/settings?calendarError=${encodeURIComponent("missing_provider_token")}`, origin)
    );
  }

  // FLUX-157: signInWithOAuth is a full sign-in, not identity linking — guard
  // against Google's account chooser returning a DIFFERENT Google identity
  // than the Rooftap user who started the connect flow, which would otherwise
  // silently swap the browser's Supabase session to another account. The
  // connect button stamped the expected user id into a short-lived cookie
  // before redirecting; verify it here and abort+sign-out on any mismatch.
  const expectedUserId = cookieStore.get("calendar_connect_uid")?.value;
  cookieStore.set("calendar_connect_uid", "", { path: "/", maxAge: 0 });
  if (!expectedUserId || expectedUserId !== session.user.id) {
    console.error(
      "[calendar-callback] session user mismatch after OAuth exchange — aborting to prevent account swap",
      { expectedUserId, actualUserId: session.user.id }
    );
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL(`/login?calendarError=${encodeURIComponent("account_mismatch")}`, origin)
    );
  }

  const admin = createAdminClient();
  // supabase-js does not expose Google's actual provider-token expiry —
  // only its own JWT's expires_in, which happens to often match Google's
  // typical token lifetime but isn't guaranteed to. Treat the freshly issued
  // access token as already stale so the very first getFreshAccessToken()
  // call refreshes it and persists Google's real expires_in instead of
  // trusting a guess.
  const expiresAt = new Date(0).toISOString();

  // Google only issues a refresh_token on the FIRST consent; a re-connect
  // without one must not clobber the existing refresh_token.
  const { data: existing } = await admin
    .from("google_calendar_connections")
    .select("refresh_token")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const refreshToken = session.provider_refresh_token ?? existing?.refresh_token;
  if (!refreshToken) {
    console.error("[calendar-callback] no refresh_token available (neither new nor existing)");
    return NextResponse.redirect(
      new URL(`/settings?calendarError=${encodeURIComponent("missing_refresh_token")}`, origin)
    );
  }

  const { error: upsertError } = await admin.from("google_calendar_connections").upsert(
    {
      user_id: session.user.id,
      access_token: session.provider_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      scopes: REQUESTED_SCOPES,
    },
    { onConflict: "user_id" }
  );

  if (upsertError) {
    console.error("[calendar-callback] upsert failed:", upsertError.message);
    return NextResponse.redirect(
      new URL(`/settings?calendarError=${encodeURIComponent(upsertError.message)}`, origin)
    );
  }

  return NextResponse.redirect(new URL("/settings?connected=google", origin));
}
