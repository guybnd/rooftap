"use client";

import { createClient } from "@/lib/supabase/client";
import { normalizeIdentifier } from '@homeup/core';
import { safeNextPath, NEXT_PATH_COOKIE } from "@/lib/next-path";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get("error");
  // Where to go after signing in (MCP sign-in consent sends people here).
  const next = safeNextPath(searchParams.get("next"));
  const [showDevLogin, setShowDevLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [devError, setDevError] = useState("");
  const [loading, setLoading] = useState(false);

  const [identifier, setIdentifier] = useState("");
  const [pwdFieldValue, setPwdFieldValue] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const isDevBuild = process.env.NODE_ENV !== "production";

  useEffect(() => {
    fetch("/api/setup/status")
      .then((res) => res.json())
      .then((data) => {
        if (data.needsFirstUser) router.replace("/welcome");
      })
      .catch(() => {});
  }, [router]);

  async function handlePasswordAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const supabase = createClient();
      const email = normalizeIdentifier(identifier);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: pwdFieldValue,
      });
      if (signInError) {
        setAuthError(signInError.message);
        return;
      }
      router.push(next);
    } catch {
      setAuthError("Network error");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    // /callback reads this back; a query string on redirectTo would have to be
    // in Supabase's allowed redirect list.
    if (next !== "/") document.cookie = `${NEXT_PATH_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback`,
      },
    });
  }

  async function handleBypassLogin(e: React.FormEvent) {
    e.preventDefault();
    setDevError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDevError(data.error || "Login failed");
      } else {
        router.push(data.redirect || "/");
      }
    } catch {
      setDevError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-primary font-bold text-xl">H</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sign in to Rooftap</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome home. One calm app for the whole household.
          </p>
        </div>

        {error === "unauthorized" && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Your account is not authorized to access this app.
          </div>
        )}

        {error === "auth_failed" && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Authentication failed. Please try again.
            {searchParams.get("reason") && (
              <p className="mt-1 text-xs opacity-70">{searchParams.get("reason")}</p>
            )}
          </div>
        )}

        <button
          onClick={signInWithGoogle}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
        >
          Continue with Google
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/50" />
          <span className="text-xs text-muted-foreground/70">or</span>
          <div className="h-px flex-1 bg-border/50" />
        </div>

        <form onSubmit={handlePasswordAuth} className="space-y-3">
          <input
            type="text"
            placeholder="Email or username"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/50"
          />
          <input
            type="password"
            placeholder="Password"
            required
            value={pwdFieldValue}
            onChange={(e) => setPwdFieldValue(e.target.value)}
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
            {authLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {isDevBuild && (
          <div className="pt-8 border-t border-border/50">
            <button
              onClick={() => setShowDevLogin(!showDevLogin)}
              className="w-full text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-2"
            >
              {showDevLogin ? "Hide" : "Dev access"}
            </button>

            {showDevLogin && (
              <form onSubmit={handleBypassLogin} className="mt-3 space-y-3">
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/50"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/50"
                />
                {devError && (
                  <p className="text-xs text-destructive">{devError}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-muted px-3 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
