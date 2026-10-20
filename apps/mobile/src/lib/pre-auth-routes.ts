// HOUP-177: screens reachable with no server/session — root layout hides the
// persistent tab bar on these, and useAuthGuard must never redirect to
// /login while already on one (that would loop). Single source of truth so
// the two consumers can't drift out of sync with each other.
// HOUP-193: /callback is reachable with no session by definition (it's the
// screen waiting for one to land) — without it here, useAuthGuard's
// onAuthStateChange fires its immediate INITIAL_SESSION event with session:
// null the instant the screen mounts and bounces straight to /login before
// the OAuth tokens are even parsed.
export const PRE_AUTH_ROUTES = ['/server-picker', '/login', '/callback'];
