import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

// Cookie-scoped server client that authenticates the calling user via
// getUser() (validates the token with the Auth server — getSession() only
// reads the cookie and is not trustworthy server-side). Mirrors
// src/app/api/push/subscribe/route.ts; centralized here once several new
// FLUX-157 routes need the same check.
//
// HOUP-100: native has no cookie jar for this origin, only a Supabase access
// token — so a second path validates an `Authorization: Bearer <token>`
// header against the Auth server directly. The cookie path stays primary and
// unchanged; the Bearer path only runs when no cookie user is found.
export async function getSessionUser() {
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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;

  const authHeader = (await headers()).get("authorization");
  const [scheme, token] = authHeader?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) return null;

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user: bearerUser } } = await anon.auth.getUser(token);
  return bearerUser ?? null;
}
