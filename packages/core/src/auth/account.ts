// Account basics shared by web and phone (independent review n7): what the
// auth server allows (sign-up, email), and deleting an account. Deleting runs
// on the web app's POST /api/account/delete, which hands each shared
// household on before the auth admin API removes the person
// (supabase/migrations/20261110050000_invite_links_and_account_deletion.sql).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthSettings {
  /** Anyone can make an account on the sign-in screen. */
  signupOpen: boolean;
  /** The auth server sends email (confirm sign-up, reset a password). */
  sendsEmail: boolean;
}

/**
 * Asks the auth server what it allows (GoTrue's public /auth/v1/settings).
 * A server with no mailer confirms new accounts at once
 * (`mailer_autoconfirm`), so it can't send a reset email either. Null when the
 * server can't be reached; callers then hide sign-up and reset.
 */
export async function fetchAuthSettings(supabaseUrl: string, anonKey: string, timeoutMs = 8000): Promise<AuthSettings | null> {
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return authSettingsFrom(await res.json());
  } catch {
    return null;
  }
}

export function authSettingsFrom(body: unknown): AuthSettings | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const external = (typeof b.external === 'object' && b.external) || {};
  const emailOn = (external as Record<string, unknown>).email !== false;
  return {
    signupOpen: emailOn && b.disable_signup === false,
    sendsEmail: emailOn && b.mailer_autoconfirm === false,
  };
}

/** The shortest password the apps accept; GoTrue's own default minimum. */
export const MIN_PASSWORD_LENGTH = 6;

export interface DeletionPlanRow {
  household: string;
  outcome: 'deleted' | 'handed_over';
  heir: string | null;
}

/** What deleting the signed-in person's account does to each of their homes. */
export async function fetchAccountDeletionPlan(supabase: SupabaseClient): Promise<DeletionPlanRow[] | null> {
  const { data, error } = await supabase.rpc('account_deletion_plan');
  if (error || !Array.isArray(data)) return null;
  return data.map((r: { household: string; outcome: string; heir: string | null }) => ({
    household: r.household,
    outcome: r.outcome === 'handed_over' ? 'handed_over' : 'deleted',
    heir: r.heir,
  }));
}

/** One line per home for the delete confirmation. */
export function deletionPlanLines(plan: readonly DeletionPlanRow[]): string[] {
  return plan.map((r) =>
    r.outcome === 'deleted'
      ? `${r.household} and everything in it is deleted, because you are its only member.`
      : `${r.household} stays. ${r.heir ?? 'The next member'} looks after it, and what you added stays with it.`,
  );
}

export const DELETE_ACCOUNT_COPY = {
  title: 'Delete account',
  row: 'Delete your account',
  lede: 'This removes your account, your comments, your settings and your connections. You cannot undo it.',
  confirmTitle: 'Delete your account?',
  confirmLabel: 'Delete account',
  failed: 'Your account was not deleted. Try again in a moment.',
  done: 'Your account is deleted.',
} as const;
