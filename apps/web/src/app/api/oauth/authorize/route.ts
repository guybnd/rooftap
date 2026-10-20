import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { checkAuthorizeRequest, createAuthorizationCode, redirectWith } from "@/lib/mcp-oauth";

// The consent form on /oauth/authorize posts here. Session cookies are
// SameSite=Lax, so a cross-site form can't carry them; the origin check is
// belt and braces on top of that.
export async function POST(req: Request) {
  const { origin } = new URL(req.url);
  const sentFrom = req.headers.get("origin");
  if (sentFrom && sentFrom !== origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin), 303);

  const form = await req.formData();
  const params = { get: (name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : null) };
  const admin = createAdminClient();
  const check = await checkAuthorizeRequest(admin, params);
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });

  const { request } = check;
  if (params.get("decision") !== "allow") {
    return NextResponse.redirect(redirectWith(request.redirectUri, { error: "access_denied", state: request.state }), 303);
  }
  const code = await createAuthorizationCode(admin, user.id, request);
  return NextResponse.redirect(redirectWith(request.redirectUri, { code, state: request.state }), 303);
}
