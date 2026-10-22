import { describe, expect, it, vi } from 'vitest';
import { completeOAuthRedirect } from './oauth-redirect';

function fakeAuth(opts: { exchangeError?: string; session?: boolean } = {}) {
  return {
    exchangeCodeForSession: vi.fn(async () => ({
      data: {},
      error: opts.exchangeError ? { message: opts.exchangeError } : null,
    })),
    getSession: vi.fn(async () => ({ data: { session: opts.session ? {} : null } })),
  } as never as Parameters<typeof completeOAuthRedirect>[0] & {
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
  };
}

describe('completeOAuthRedirect', () => {
  it('ignores tokens in the link: only a code signs in', async () => {
    const auth = fakeAuth();
    const out = await completeOAuthRedirect(auth, { access_token: 'a', refresh_token: 'r' });
    expect(out).toEqual({ status: 'no-code' });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('exchanges the code once when both screens see it', async () => {
    const auth = fakeAuth();
    const [a, b] = await Promise.all([
      completeOAuthRedirect(auth, { code: 'code-1' }),
      completeOAuthRedirect(auth, { code: 'code-1' }),
    ]);
    expect(a).toEqual({ status: 'signed-in' });
    expect(b).toEqual({ status: 'signed-in' });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('reports a failed exchange when no session exists', async () => {
    const auth = fakeAuth({ exchangeError: 'code verifier missing' });
    expect(await completeOAuthRedirect(auth, { code: 'code-2' })).toEqual({
      status: 'error',
      message: 'code verifier missing',
    });
  });

  it('passes the provider error through', async () => {
    const auth = fakeAuth();
    expect(await completeOAuthRedirect(auth, { error: 'access_denied', error_description: 'Denied' })).toEqual({
      status: 'error',
      message: 'Denied',
    });
  });
});
