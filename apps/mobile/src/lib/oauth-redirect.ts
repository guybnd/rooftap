// Security audit (2026-10-22): Google sign-in on the phone uses the PKCE
// flow (core's createNativeClient sets flowType: 'pkce'). The redirect link
// back into the app carries a one-time code, never tokens. Only this device
// holds the matching code verifier, so another app that catches the
// `mobile://` link, or a crafted link that tries to sign the phone into
// someone else's account, gets nothing it can use.
//
// login.tsx (the browser-session promise) and callback.tsx (the deep link,
// when the OS delivers the redirect as a Linking event) can both see the
// same code. A code works once, so both share one exchange per code.
import type { SupabaseClient } from '@supabase/supabase-js';

export type OAuthRedirectResult =
  | { status: 'signed-in' }
  | { status: 'error'; message: string }
  | { status: 'no-code' };

const exchanges = new Map<string, Promise<OAuthRedirectResult>>();

export function completeOAuthRedirect(
  supabase: Pick<SupabaseClient['auth'], 'exchangeCodeForSession' | 'getSession'>,
  params: Record<string, string | undefined>,
  errorCode?: string | null,
): Promise<OAuthRedirectResult> {
  if (errorCode || params.error) {
    return Promise.resolve({
      status: 'error',
      message: params.error_description || params.error || errorCode || 'Google sign-in failed',
    });
  }
  const code = params.code;
  if (!code) return Promise.resolve({ status: 'no-code' });

  let exchange = exchanges.get(code);
  if (!exchange) {
    exchange = (async (): Promise<OAuthRedirectResult> => {
      const { error } = await supabase.exchangeCodeForSession(code);
      if (!error) return { status: 'signed-in' };
      // The other screen may have used the code a moment earlier.
      const { data } = await supabase.getSession();
      return data.session ? { status: 'signed-in' } : { status: 'error', message: error.message };
    })();
    exchanges.set(code, exchange);
  }
  return exchange;
}
