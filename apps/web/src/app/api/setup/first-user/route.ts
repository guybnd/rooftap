import { NextResponse } from "next/server";
import { normalizeIdentifier } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated: the one remaining signup door once GoTrue's own
// disable_signup closes /auth/v1/signup (HOUP-310). Self-gated on "does any
// user already exist" via the same listUsers({page:1,perPage:1}) count
// api/setup/status/route.ts uses — fail closed if that read errors.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const identifier: string | undefined = body?.identifier;
  const password: string | undefined = body?.password;
  const displayName: string | undefined = body?.displayName;

  if (!identifier?.trim() || !password || password.length < 6) {
    return NextResponse.json(
      { error: "A username or email, and a password of at least 6 characters, are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (listError) {
    return NextResponse.json({ error: "Could not reach the auth service" }, { status: 503 });
  }
  if ((existing?.users.length ?? 0) > 0) {
    return NextResponse.json({ error: "Registration is closed" }, { status: 409 });
  }

  const email = normalizeIdentifier(identifier);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName?.trim() || identifier.trim() },
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Failed to create user" }, { status: 500 });
  }

  return NextResponse.json({ userId: created.user.id, email }, { status: 201 });
}
