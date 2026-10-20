import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNextPath, NEXT_PATH_COOKIE } from "@/lib/next-path";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Default to the root page, which resolves the user's Home/last-used section
  // (defaults to the Home hub). Never hardcode a section landing here.
  // The login page leaves a cookie when sign-in should return somewhere
  // (MCP sign-in consent). Only same-site paths are followed.
  const cookieStore = await cookies();
  const next = safeNextPath(searchParams.get("next") ?? cookieStore.get(NEXT_PATH_COOKIE)?.value ?? null);

  // OAuth provider may return an error instead of a code
  const oauthError = searchParams.get("error");
  const oauthErrorDesc = searchParams.get("error_description");
  if (oauthError) {
    return NextResponse.redirect(new URL(`/login?error=auth_failed&reason=${encodeURIComponent(oauthErrorDesc || oauthError)}`, origin));
  }

  if (code) {
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      cookieStore.delete(NEXT_PATH_COOKIE);
      return NextResponse.redirect(new URL(next, origin));
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message, error.status);
    return NextResponse.redirect(new URL(`/login?error=auth_failed&reason=${encodeURIComponent(error.message)}`, origin));
  }

  const allParams = searchParams.toString();
  return NextResponse.redirect(new URL(`/login?error=auth_failed&reason=${encodeURIComponent("no_code; params=" + allParams)}`, origin));
}
