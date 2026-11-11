"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FIELD_IN_GROUP, FieldGroup, FirstRunHeader } from "@/components/first-run";
import { AUTH_PRIMARY, AuthLink, AuthNote, AuthScreen } from "@/components/auth-screen";
import { createClient } from "@/lib/supabase/client";
import {
  INVITE_COPY,
  MIN_PASSWORD_LENGTH,
  inviteTokenFrom,
  joinByInvite,
  normalizeIdentifier,
  peekInvite,
  type InvitePreview,
  type JoinResult,
} from "@homeup/core";

// Where a household invite link (or its QR code) opens (independent review
// n1). Public: a person with no account makes one here and lands in the home.
// Someone signed in joins with one tap. The page says first what joining does
// to the home they are in now (core peekInvite's `fit`).
export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = inviteTokenFrom(params.token ?? "");
  const [preview, setPreview] = useState<InvitePreview | null | "failed" | undefined>(undefined);
  const [signedIn, setSignedIn] = useState(false);

  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      return;
    }
    let live = true;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.auth.getSession();
      const p = await peekInvite(supabase, token);
      if (!live) return;
      setSignedIn(!!data.session);
      setPreview(p);
    })();
    return () => {
      live = false;
    };
  }, [token]);

  function finish(result: JoinResult) {
    if (result === "joined" || result === "already_member") {
      // A full load, so the app reads the new home from the start.
      window.location.assign("/");
      return;
    }
    if (result === "invited") {
      setInvited(true);
      return;
    }
    setError(result === "expired" ? INVITE_COPY.expired : result === "not_found" ? INVITE_COPY.notFound : "Could not join. Try again.");
  }

  async function handleJoin() {
    if (!token) return;
    setError("");
    setBusy(true);
    try {
      finish(await joinByInvite(createClient(), token));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/invite/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, identifier, password, displayName: name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not make the account.");
        return;
      }
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizeIdentifier(identifier), password });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      finish(await joinByInvite(supabase, token));
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (preview === undefined) return null;

  if (preview === null || preview === "failed" || preview.expired) {
    const lede = preview === "failed" ? "Could not open this invite. Check your connection and try again." : preview?.expired ? INVITE_COPY.expired : INVITE_COPY.notFound;
    return (
      <AuthScreen>
        <FirstRunHeader title="Invite link" lede={lede} />
        <div className="text-center">
          <AuthLink href="/login">Go to sign in</AuthLink>
        </div>
      </AuthScreen>
    );
  }

  const household = preview.household;

  if (invited) {
    return (
      <AuthScreen>
        <FirstRunHeader title={`Join ${household}`} lede={INVITE_COPY.invited(household)} />
        <Link href="/settings/house" className={`${AUTH_PRIMARY} flex items-center justify-center`}>
          Open Settings
        </Link>
      </AuthScreen>
    );
  }

  const who = preview.invitedBy || "Someone";
  const people = preview.members === 1 ? "1 person lives there" : `${preview.members} people live there`;
  const intro = `${who} invited you. ${people}.`;

  if (signedIn) {
    const current = preview.currentHousehold ?? "your home";
    const lede =
      preview.fit === "member"
        ? `You are already in ${household}.`
        : preview.fit === "leave"
          ? `${intro} You leave ${current}, and its things stay with the people still there.`
          : preview.fit === "has_things"
            ? `${intro} ${current} has your things in it, so you choose what happens to them in Settings first.`
            : intro;
    return (
      <AuthScreen>
        <FirstRunHeader title={`Join ${household}`} lede={lede} />
        {error && <AuthNote tone="error">{error}</AuthNote>}
        {preview.fit === "member" ? (
          <Link href="/" className={`${AUTH_PRIMARY} flex items-center justify-center`}>
            Open Rooftap
          </Link>
        ) : (
          <button type="button" disabled={busy} onClick={handleJoin} className={AUTH_PRIMARY}>
            {busy ? "Joining..." : `Join ${household}`}
          </button>
        )}
      </AuthScreen>
    );
  }

  const next = encodeURIComponent(`/join/${token}`);
  return (
    <AuthScreen>
      <FirstRunHeader title={`Join ${household}`} lede={`${intro} Make an account to join.`} />
      <form onSubmit={handleCreate} className="space-y-4">
        <FieldGroup>
          <input
            type="text"
            placeholder="Your name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_IN_GROUP}
          />
          <input
            type="text"
            placeholder="Email or username"
            autoComplete="email"
            autoCapitalize="none"
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
          {busy ? "Joining..." : "Make account and join"}
        </button>
      </form>
      <div className="text-center">
        <AuthLink href={`/login?next=${next}`}>I have an account</AuthLink>
      </div>
    </AuthScreen>
  );
}
