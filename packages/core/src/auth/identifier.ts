const LOCAL_EMAIL_DOMAIN = "homeup.local";

// GoTrue always requires an email, even for local-only accounts (email is
// mandatory on both `signUp`/`signInWithPassword` and `auth.admin.createUser`
// — see GOTRUE_EXTERNAL_PHONE_ENABLED="false" in docker-compose.yml, phone
// auth being the only other identifier GoTrue supports). When the typed
// identifier has no "@", treat it as a local username and synthesize an
// internal-only email so the operator never needs a real email address. Real
// emails (and Google-OAuth accounts, which always carry one) pass through
// unchanged. This is the single source of truth for the synth rule — welcome,
// login signup, and login signin all call it, and HOUP-24 (create-user) reuses
// it too. If signup and signin ever normalize differently, an account becomes
// unreachable.
export function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed}@${LOCAL_EMAIL_DOMAIN}`;
}
