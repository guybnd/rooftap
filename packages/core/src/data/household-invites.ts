// Household invite links (independent review n1). An owner shares one link
// (and its QR code) per household; whoever opens it can join, also a person
// with no account yet. The database side is in
// supabase/migrations/20261110050000_invite_links_and_account_deletion.sql:
// the token is only reachable through these RPCs. Web and phone share these
// helpers; the invitee's page is the web app's /join/<token>.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Where an invite link opens, on the server the household lives on. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${token}`;
}

/** The token in a pasted invite link (or a bare token), or null. */
export function inviteTokenFrom(input: string): string | null {
  const trimmed = input.trim();
  const match = /(?:^|\/join\/)([0-9a-f]{32})(?:[/?#]|$)/i.exec(trimmed);
  return match ? match[1].toLowerCase() : null;
}

export interface InviteLink {
  token: string;
  expiresAt: string;
}

/** The household's live link, made when there is none (or `renew` asks for a new one). Owners only. */
export async function fetchInviteLink(
  supabase: SupabaseClient,
  groupId: string,
  renew = false,
): Promise<InviteLink | null> {
  const { data, error } = await supabase.rpc('household_invite_link', { p_group_id: groupId, p_renew: renew });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.token) return null;
  return { token: row.token as string, expiresAt: row.expires_at as string };
}

/** Turns the household's link off, so it no longer works. */
export async function stopInviteLink(supabase: SupabaseClient, groupId: string): Promise<boolean> {
  const { error } = await supabase.rpc('stop_household_invite_link', { p_group_id: groupId });
  return !error;
}

/**
 * What joining does for a signed-in person: they are already in it, have
 * nothing to lose, leave a household they share, or have things in their own
 * household (they then accept an invitation in Settings).
 */
export type InviteFit = 'member' | 'fresh' | 'leave' | 'has_things';

export interface InvitePreview {
  household: string;
  invitedBy: string;
  members: number;
  expired: boolean;
  /** null when nobody is signed in. */
  fit: InviteFit | null;
  currentHousehold: string | null;
}

/** What a link opens; null for a link that doesn't exist (or was replaced). Works signed out. */
export async function peekInvite(supabase: SupabaseClient, token: string): Promise<InvitePreview | null | 'failed'> {
  const { data, error } = await supabase.rpc('peek_household_invite', { p_token: token });
  if (error) return 'failed';
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    household: row.household ?? 'A household',
    invitedBy: row.invited_by ?? '',
    members: row.members ?? 0,
    expired: !!row.expired,
    fit: (row.fit as InviteFit | null) ?? null,
    currentHousehold: row.current_household ?? null,
  };
}

export type JoinResult = 'joined' | 'already_member' | 'invited' | 'expired' | 'not_found' | 'failed';

export async function joinByInvite(supabase: SupabaseClient, token: string): Promise<JoinResult> {
  const { data, error } = await supabase.rpc('join_household_by_invite', { p_token: token });
  if (error) {
    if (error.message.includes('invite_expired')) return 'expired';
    if (error.message.includes('invite_not_found')) return 'not_found';
    return 'failed';
  }
  return data === 'joined' || data === 'already_member' || data === 'invited' ? data : 'failed';
}

/** Words both apps use for invites. Hearth copy: no em dashes, no emoji. */
export const INVITE_COPY = {
  title: 'Invite someone',
  lede: 'Anyone with this link can join your home, also without an account. It works for 30 days.',
  notOwner: 'Only an owner of this home can invite people. Ask them for the link.',
  share: (household: string, url: string) => `Join ${household} on Rooftap: ${url}`,
  renewConfirm: 'Make a new link? The old link stops working.',
  stopConfirm: 'Turn this link off? Nobody can join with it after that.',
  expired: 'This invite link has run out. Ask for a new one.',
  notFound: 'This invite link does not work any more. Ask for a new one.',
  invited: (household: string) =>
    `Your own home has things in it. To join ${household}, open Settings, then Home, and accept the invitation there. You then choose what happens to your things.`,
} as const;

/** How long the link has left, read mid-sentence ("Works for 12 more days"). */
export function inviteLinkLifeLabel(expiresAt: string, now = Date.now()): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000);
  if (days <= 0) return 'Ran out';
  if (days === 1) return 'Works until tomorrow';
  return `Works for ${days} more days`;
}
