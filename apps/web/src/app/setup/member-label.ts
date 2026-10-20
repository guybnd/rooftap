// FLUX-60: Resolve a user_id to a display label for assignee UI.
// A user_id with no profile means the person has left the group — show
// "Former member" rather than a blank or a raw UUID (same graceful handling
// the setup section expects for assigned items).

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

/** True when the assignee is set but no longer a member of the group. */
export function isFormerMember(userId: string | null, profiles: MemberProfiles): boolean {
  return !!userId && !profiles[userId];
}

/** Avatar URL for a user, or null to fall back to initials. */
export function memberAvatar(userId: string | null, profiles: MemberProfiles): string | null {
  if (!userId) return null;
  return profiles[userId]?.avatar ?? null;
}
