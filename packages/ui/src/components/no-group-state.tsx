// HOUP-179: shared "no group" empty state — replaces the inert
// `<Text>No group selected</Text>` dead end that was duplicated verbatim
// across 20 mobile screens. Pure presentation only: the actual
// create-household action (re-running fetchGroupData's auto-create) and the
// accept/decline-invite RPCs (AcceptInvitationDialog, HOUP-84) live with the
// caller, which has access to useDataCache() and the Supabase client — this
// component just renders the choice and forwards taps. Follows the Hearth
// empty-state convention (style guide §11 / apartment-grid.tsx's "No
// apartments yet"): centered, rounded-2xl bg-primary/10 icon, one headline,
// one description, one primary CTA.
import * as React from 'react';
import { Text, View } from 'react-native';
import { Home, Mail } from 'lucide-react-native';
import type { GroupInvitation } from '@homeup/core';
import { cn } from '../lib/cn';
import { Button } from './button';

export interface NoGroupStateProps {
  /** Pending invitations for the current user (empty when none). */
  pendingInvitations: GroupInvitation[];
  /** True while a create-household attempt is in flight — disables the CTA. */
  creating?: boolean;
  onCreateHousehold: () => void;
  /** Only needed when pendingInvitations is non-empty. */
  onReviewInvite?: (invitation: GroupInvitation) => void;
  className?: string;
}

export function NoGroupState({
  pendingInvitations,
  creating = false,
  onCreateHousehold,
  onReviewInvite,
  className,
}: NoGroupStateProps) {
  const invite = pendingInvitations[0];

  if (invite) {
    const groupName = invite.group_name ?? 'a household';
    return (
      <View className={cn('items-center gap-3', className)}>
        <View className="rounded-2xl bg-primary/10 p-5">
          <Mail size={28} className="text-primary" />
        </View>
        <Text className="text-title font-semibold text-foreground">You&apos;re invited</Text>
        <Text className="max-w-xs text-center text-caption text-muted-foreground">
          You&apos;ve been invited to join{' '}
          <Text className="font-medium text-foreground">{groupName}</Text>
          {pendingInvitations.length > 1 ? ` (+${pendingInvitations.length - 1} more)` : ''}.
        </Text>
        <Button size="sm" onPress={() => onReviewInvite?.(invite)}>
          Review invite
        </Button>
        <Button variant="ghost" size="sm" disabled={creating} onPress={onCreateHousehold}>
          {creating ? 'Creating…' : 'Or create your own household'}
        </Button>
      </View>
    );
  }

  return (
    <View className={cn('items-center gap-3', className)}>
      <View className="rounded-2xl bg-primary/10 p-5">
        <Home size={28} className="text-primary" />
      </View>
      <Text className="text-title font-semibold text-foreground">Let&apos;s set up your household</Text>
      <Text className="max-w-xs text-center text-caption text-muted-foreground">
        Create a household to start tracking tasks, budget, and more together.
      </Text>
      <Button size="sm" disabled={creating} onPress={onCreateHousehold}>
        {creating ? 'Creating…' : 'Create a household'}
      </Button>
    </View>
  );
}
