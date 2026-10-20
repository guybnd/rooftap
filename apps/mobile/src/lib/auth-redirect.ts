// HOUP-178: shared "bounce to /login" used by both useAuthGuard (an
// onAuthStateChange SIGNED_OUT event) and DataCacheProvider's fetchAll (a
// fresh fetchGroupData() call that resolves currentUserId: null) — extracted
// so the two paths that both discover "there's no session" redirect the same
// way instead of drifting apart.
import type { useRouter } from 'expo-router';
import { PRE_AUTH_ROUTES } from './pre-auth-routes';

export function redirectToLogin(router: Pick<ReturnType<typeof useRouter>, 'replace'>, pathname: string): void {
  if (PRE_AUTH_ROUTES.includes(pathname)) return;
  router.replace('/login');
}
