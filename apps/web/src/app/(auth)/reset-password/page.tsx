"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FIELD_IN_GROUP, FieldGroup, FirstRunHeader } from "@/components/first-run";
import { AUTH_PRIMARY, AuthLink, AuthNote, AuthScreen } from "@/components/auth-screen";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD_LENGTH } from "@homeup/core";

// Where a reset email's link lands. The browser client trades the link's code
// for a session on load (it holds the code verifier from /forgot-password, so
// the link works in the browser that asked for it). Then the person picks a
// new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (live) setReady(!!data.session);
      })
      .catch(() => live && setReady(false));
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      router.push("/");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (ready === null) return null;

  if (!ready) {
    return (
      <AuthScreen>
        <FirstRunHeader
          title="This link has run out"
          lede="A reset link works once, and only in the browser where you asked for it. Ask for a new one."
        />
        <div className="text-center">
          <AuthLink href="/forgot-password">Send a new link</AuthLink>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <FirstRunHeader title="Set a new password" lede="You stay signed in on this device after you save it." />
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldGroup>
          <input
            type="password"
            placeholder="New password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD_IN_GROUP}
          />
        </FieldGroup>
        {error && <AuthNote tone="error">{error}</AuthNote>}
        <button type="submit" disabled={busy} className={AUTH_PRIMARY}>
          {busy ? "Saving..." : "Save password"}
        </button>
      </form>
    </AuthScreen>
  );
}
