import { NextResponse } from "next/server";
import { MIN_PASSWORD_LENGTH, inviteTokenFrom, normalizeIdentifier } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";

// Public: makes an account for a person who opened a household invite link
// (/join/<token>), so they can sign in and join. The link is the permission,
// so this works on a self-hosted server where public sign-up is closed
// (GOTRUE_DISABLE_SIGNUP). claim_invite_account checks the link is live and
// counts the account; a link makes at most 20. The person then signs in with
// the password and joins through join_household_by_invite, like anyone else.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? inviteTokenFrom(body.token) : null;
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";

  if (!token) return NextResponse.json({ error: "This invite link does not work." }, { status: 400 });
  if (!identifier || identifier.length > 254) {
    return NextResponse.json({ error: "Enter an email address or a username." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_invite_account", { p_token: token });
  if (claimError) return NextResponse.json({ error: "Could not check the invite link." }, { status: 503 });
  if (!claimed) {
    return NextResponse.json({ error: "This invite link has run out. Ask for a new one." }, { status: 410 });
  }

  const email = normalizeIdentifier(identifier);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName || identifier },
  });
  if (createError || !created.user) {
    const taken = createError?.status === 422 || /already/i.test(createError?.message ?? "");
    return NextResponse.json(
      { error: taken ? "This email already has an account. Sign in instead." : "Could not make the account." },
      { status: taken ? 409 : 500 }
    );
  }

  return NextResponse.json({ email }, { status: 201 });
}
