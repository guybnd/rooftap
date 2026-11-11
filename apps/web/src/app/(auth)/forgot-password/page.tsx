"use client";

import { useState } from "react";
import { FIELD_IN_GROUP, FieldGroup, FirstRunHeader } from "@/components/first-run";
import { AUTH_PRIMARY, AuthLink, AuthNote, AuthScreen } from "@/components/auth-screen";
import { createClient } from "@/lib/supabase/client";
import { useAuthSettings } from "@/lib/hooks/use-auth-settings";

// Asks for a password reset email (independent review n7). The email's link
// opens /reset-password in this browser, where the new password is set. The
// phone app opens this page too, so the whole reset happens in one browser.
// A server with no mailer can't send it, so the page says who can help.
export default function ForgotPasswordPage() {
  const settings = useAuthSettings();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (settings === undefined) return null;

  if (!settings?.sendsEmail) {
    return (
      <AuthScreen>
        <FirstRunHeader
          title="Forgot your password?"
          lede="This server cannot send email. Ask the person who runs it to set a new password for you."
        />
        <div className="text-center">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </div>
      </AuthScreen>
    );
  }

  if (sent) {
    return (
      <AuthScreen>
        <FirstRunHeader title="Check your email" lede="If that email has an account, a link to set a new password is on its way. Open it on this device." />
        <div className="text-center">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <FirstRunHeader title="Forgot your password?" lede="Enter your email and we send you a link to set a new one." />
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldGroup>
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD_IN_GROUP}
          />
        </FieldGroup>
        {error && <AuthNote tone="error">{error}</AuthNote>}
        <button type="submit" disabled={busy} className={AUTH_PRIMARY}>
          {busy ? "Sending..." : "Send link"}
        </button>
      </form>
      <div className="text-center">
        <AuthLink href="/login">Back to sign in</AuthLink>
      </div>
    </AuthScreen>
  );
}
