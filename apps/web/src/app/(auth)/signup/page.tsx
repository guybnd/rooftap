"use client";

import { useState } from "react";
import { FIELD_IN_GROUP, FieldGroup, FirstRunHeader, LegalLine } from "@/components/first-run";
import { AUTH_PRIMARY, AuthLink, AuthNote, AuthScreen } from "@/components/auth-screen";
import { createClient } from "@/lib/supabase/client";
import { useAuthSettings } from "@/lib/hooks/use-auth-settings";
import { useLegalLinks } from "@/lib/hooks/use-legal-links";
import { MIN_PASSWORD_LENGTH, normalizeIdentifier } from "@homeup/core";
import { useRouter } from "next/navigation";

// Email sign-up (independent review n7). Shown only when the auth server takes
// new accounts. A server that sends email asks the person to confirm first;
// the link brings them back to the sign-in screen. A server with no mailer
// confirms at once and signs them in. Either way their own home is made for
// them on the first sign-in, as with Google.
export default function SignUpPage() {
  const router = useRouter();
  const settings = useAuthSettings();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Terms and Privacy Policy links, when this server has them (lib/legal-links.ts).
  const legal = useLegalLinks();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const email = normalizeIdentifier(identifier);
      const { data, error: signUpError } = await createClient().auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() || identifier.trim() },
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        router.push("/");
        return;
      }
      setSentTo(email);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (settings === undefined) return null;

  if (!settings?.signupOpen) {
    return (
      <AuthScreen>
        <FirstRunHeader title="Join Rooftap" lede="This server does not take new sign-ups. Ask someone in your home for an invite link." />
        <div className="text-center">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </div>
      </AuthScreen>
    );
  }

  if (sentTo) {
    return (
      <AuthScreen>
        <FirstRunHeader title="Check your email" lede={`We sent a link to ${sentTo}. Open it to confirm your account, then sign in.`} />
        <div className="text-center">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <FirstRunHeader title="Make an account" lede="Your own home comes with it. You can invite people, or join theirs with an invite link." />
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldGroup>
          <input
            type="text"
            placeholder="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_IN_GROUP}
          />
          <input
            type={settings.sendsEmail ? "email" : "text"}
            placeholder={settings.sendsEmail ? "Email" : "Email or username"}
            autoComplete="email"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className={FIELD_IN_GROUP}
          />
          <input
            type="password"
            placeholder="Password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD_IN_GROUP}
          />
        </FieldGroup>
        {error && <AuthNote tone="error">{error}</AuthNote>}
        <button type="submit" disabled={busy} className={AUTH_PRIMARY}>
          {busy ? "Making your account..." : "Make account"}
        </button>
      </form>
      <LegalLine links={legal} />
      <div className="text-center">
        <AuthLink href="/login">I have an account</AuthLink>
      </div>
    </AuthScreen>
  );
}
