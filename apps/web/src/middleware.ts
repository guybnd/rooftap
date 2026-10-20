import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isLandingPageEnabled } from "@/lib/landing";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/welcome") ||
    request.nextUrl.pathname.startsWith("/callback") ||
    request.nextUrl.pathname.startsWith("/logout") ||
    request.nextUrl.pathname.startsWith("/privacy") ||
    request.nextUrl.pathname.startsWith("/api/auth/bypass") ||
    request.nextUrl.pathname.startsWith("/api/setup/status") ||
    request.nextUrl.pathname.startsWith("/api/setup/first-user") ||
    request.nextUrl.pathname.startsWith("/api/mcp") ||
    // HOUP-69: the native app's server picker calls this before it has any
    // session — must stay unauthenticated.
    request.nextUrl.pathname.startsWith("/api/public-config");

  // The public landing page (lib/landing.ts says where it is on).
  const landing = isLandingPageEnabled();
  if (isPublicRoute || (landing && request.nextUrl.pathname === "/landing")) {
    return supabaseResponse;
  }

  // HOUP-154 fix: native clients authenticate API calls with a Bearer token,
  // not cookies. Redirecting their POSTs to /login turns into a 405 (the 307
  // preserves the method against a GET-only page). Let them through — every
  // /api route validates the token itself via getSessionUser()'s Bearer branch
  // and returns a proper 401 when it's missing/invalid.
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    request.headers.get("authorization")?.startsWith("Bearer ")
  ) {
    return supabaseResponse;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Signed-out visitors to `/` see the landing page, with `/` kept in the address bar.
    if (landing && request.nextUrl.pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/landing";
      return NextResponse.rewrite(url);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json|sw.js|swe-worker).*)",
  ],
};
