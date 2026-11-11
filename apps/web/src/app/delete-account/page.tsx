"use client";

import { useEffect, useState } from "react";
import { FirstRunHeader } from "@/components/first-run";
import { AUTH_PRIMARY, AuthLink, AuthScreen } from "@/components/auth-screen";
import { useDeleteAccount } from "@/components/delete-account-settings";
import { createClient } from "@/lib/supabase/client";
import { DELETE_ACCOUNT_COPY } from "@homeup/core";

// The public account-deletion page the Play Store asks for. It says how to
// delete an account in the app, and deletes it here after sign-in.
export default function DeleteAccountPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { busy, run } = useDeleteAccount();

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => setSignedIn(!!data.session))
      .catch(() => setSignedIn(false));
  }, []);

  if (signedIn === null) return null;

  return (
    <AuthScreen>
      <FirstRunHeader title="Delete your Rooftap account" lede={DELETE_ACCOUNT_COPY.lede} />
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>In the app, open Settings, then About, and tap Delete account. Or sign in here and delete it now.</p>
        <p>
          If other people share your home, the home stays with them, and the things that you added stay with it. A home where you are the
          only member is deleted with everything in it, its files too.
        </p>
      </div>
      {signedIn ? (
        <button type="button" disabled={busy} onClick={run} className={AUTH_PRIMARY}>
          {busy ? "Deleting..." : DELETE_ACCOUNT_COPY.confirmLabel}
        </button>
      ) : (
        <AuthLink href="/login?next=%2Fdelete-account" className="block text-center">
          Sign in to delete your account
        </AuthLink>
      )}
    </AuthScreen>
  );
}
