"use client";

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
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-primary font-bold text-xl">H</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Rooftap</h1>
          <p className="text-sm text-muted-foreground mt-1">
            One calm app for the whole household. Let&apos;s set up your account.
          </p>
        </div>

        <form onSubmit={handleCreateAccount} className="space-y-3">
          <input
            type="text"
            placeholder="Choose a username or email"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/50"
          />
          <input
            type="text"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/50"
          />
          <input
            type="password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/50"
          />

          {authError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={authLoading}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {authLoading ? "Creating account..." : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}
