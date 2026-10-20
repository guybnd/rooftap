// Household (group) management writes, shared by web's
// components/group-manager.tsx and mobile's settings/panels/group-manager.tsx,
// which used to run these queries inline. Reads live in group-data.ts.
// Each call returns the Supabase error (or null) so callers keep their own
// toast/alert wording.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/** Display labels (name, else email, else short id) for the given user ids. */
export async function fetchProfileLabels(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Record<string, string> | null> {
  const { data } = await supabase.rpc('get_member_profiles', { member_ids: userIds });
  if (!data) return null;
  const labels: Record<string, string> = {};
  for (const p of data as { id: string; email: string; display_name: string }[]) {
    labels[p.id] = p.display_name || p.email || p.id.slice(0, 8);
  }
  return labels;
}

export async function renameGroup(supabase: SupabaseClient, groupId: string, name: string): Promise<PostgrestError | null> {
  const { error } = await supabase.from('groups').update({ name }).eq('id', groupId);
  return error;
}

export async function setGroupRegion(supabase: SupabaseClient, groupId: string, region: string): Promise<PostgrestError | null> {
  const { error } = await supabase.from('groups').update({ region }).eq('id', groupId);
  return error;
}

/** null = follow the region's currency. */
export async function setGroupCurrency(supabase: SupabaseClient, groupId: string, currency: string | null): Promise<PostgrestError | null> {
  const { error } = await supabase.from('groups').update({ currency }).eq('id', groupId);
  return error;
}

export type GroupInviteResult = 'sent' | 'not_found' | 'already_member' | 'already_invited' | 'failed';

/** User-facing message for every invite outcome except 'sent'. */
export const GROUP_INVITE_ERRORS: Record<Exclude<GroupInviteResult, 'sent'>, string> = {
  not_found: 'User not found. They must sign up first.',
  already_member: 'User is already a member',
  already_invited: 'Invitation already sent to this user',
  failed: 'Failed to send invitation',
};

/**
 * Invite an existing user (looked up by email) to the group. Members and
 * users with a pending invitation are refused before anything is written.
 */
export async function inviteToGroup(
  supabase: SupabaseClient,
  opts: {
    groupId: string;
    invitedBy: string | null;
    email: string;
    memberIds: string[];
    invitedIds: string[];
  },
): Promise<GroupInviteResult> {
  const { data: userId, error: lookupErr } = await supabase.rpc('lookup_user_id_by_email', { p_email: opts.email });
  if (lookupErr || !userId) return 'not_found';
  if (opts.memberIds.includes(userId)) return 'already_member';
  if (opts.invitedIds.includes(userId)) return 'already_invited';
  const { error } = await supabase
    .from('group_invitations')
    .insert({ group_id: opts.groupId, invited_by: opts.invitedBy, invited_user_id: userId });
  return error ? 'failed' : 'sent';
}

export async function cancelGroupInvitation(supabase: SupabaseClient, invitationId: string): Promise<PostgrestError | null> {
  const { error } = await supabase.from('group_invitations').delete().eq('id', invitationId);
  return error;
}

export async function declineGroupInvitation(supabase: SupabaseClient, invitationId: string): Promise<PostgrestError | null> {
  const { error } = await supabase.rpc('decline_invitation', { invitation_id: invitationId });
  return error;
}

export async function removeGroupMember(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<PostgrestError | null> {
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  return error;
}
