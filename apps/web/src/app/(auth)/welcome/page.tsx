"use client";

import { FIELD_IN_GROUP, FieldGroup, FirstRunHeader } from "@/components/first-run";
import { createClient } from "@/lib/supabase/client";
import { normalizeIdentifier } from '@homeup/core';
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// First-run-only welcome screen: creates the first account on a fresh
// self-hosted install. Redirects to /login once any account exists (checked
// via /api/setup/status) so it can never be reused to create a second
// "first" account.
export default function WelcomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((res) => res.json())
      .then((data) => {
        if (!data.needsFirstUser) {
          router.replace("/login");
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const email = normalizeIdentifier(identifier);
      const res = await fetch("/api/setup/first-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, displayName }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setAuthError("Registration is closed. Ask your household owner for an account.");
        } else {
          const data = await res.json().catch(() => null);
          setAuthError(data?.error || "Failed to create account");
        }
        return;
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setAuthError(signInError.message);
        return;
      }
      router.push("/");
    } catch {
      setAuthError("Network error");
    } finally {
      setAuthLoading(false);
    }
  }

  if (checking) return null;

  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <FirstRunHeader title="Welcome to Rooftap" lede="One calm app for the whole household. First, set up your account." />

        <form onSubmit={handleCreateAccount} className="space-y-4">
          <FieldGroup>
          <input
            type="text"
            placeholder="Choose a username or email"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className={FIELD_IN_GROUP}
          />
          <input
            type="text"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={FIELD_IN_GROUP}
          />
          <input
            type="password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD_IN_GROUP}
          />
          </FieldGroup>

          {authError && <p role="alert" className="-mt-2 px-1 text-xs text-destructive">{authError}</p>}

          <button
            type="submit"
            disabled={authLoading}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {authLoading ? "Creating account..." : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}
