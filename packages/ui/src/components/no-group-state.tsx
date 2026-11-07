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
import { ChevronRight, Plus } from 'lucide-react-native';
import type { GroupInvitation } from '@homeup/core';
import { cn } from '../lib/cn';
import * as haptics from '../lib/haptics';
import { Button } from './button';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from './list-item';

export interface NoGroupStateProps {
  /** Pending invitations for the current user (empty when none). */
  pendingInvitations: GroupInvitation[];
  /** True while a create-household attempt is in flight — disables the CTA. */
  creating?: boolean;
  onCreateHousehold: () => void;
  /** Only needed when pendingInvitations is non-empty. */
  onReviewInvite?: (invitation: GroupInvitation) => void;
  /** The app's first-run lede (the Rooftap mark over its glow), drawn above the words. */
  mark?: React.ReactNode;
  className?: string;
}

/**
 * Hearth §13.12: the mark, one line on what a household is, then a group of
 * invitations waiting for you (each with Join) and a row to start your own.
 */
export function NoGroupState({ pendingInvitations, creating = false, onCreateHousehold, onReviewInvite, mark, className }: NoGroupStateProps) {
  return (
    <View className={cn('w-full max-w-sm gap-5', className)}>
      <View className="items-center gap-2">
        {mark}
        <Text className="text-center font-heading text-[26px] font-bold leading-tight text-foreground" accessibilityRole="header">
          One roof, a few people
        </Text>
        <Text className="max-w-xs text-center text-body text-muted-foreground">
          {pendingInvitations.length > 0 ? 'Join the household you were invited to, or start your own.' : 'Start a household. You can invite people after.'}
        </Text>
      </View>

      {pendingInvitations.length > 0 && (
        <View className="gap-2">
          <Text className="px-1 text-micro-label uppercase text-muted-foreground">Waiting for you</Text>
          <ListGroup>
            {pendingInvitations.map((invite) => {
              const name = invite.group_name ?? 'A household';
              return (
                <ListItem
                  key={invite.id}
                  className="items-center gap-3"
                  onPress={() => {
                    haptics.select();
                    onReviewInvite?.(invite);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Invitation to ${name}. Review`}
                >
                  <View className="size-9 items-center justify-center rounded-full bg-muted">
                    <Text className="text-body font-semibold text-foreground">{name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1}>{name}</ListItemTitle>
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground">You are invited</Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing className="mt-0">
                    <Button size="sm" onPress={() => onReviewInvite?.(invite)} accessibilityLabel={`Review the invitation to ${name}`}>
                      Review
                    </Button>
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </ListGroup>
        </View>
      )}

      <View className="gap-2">
        {pendingInvitations.length > 0 && <Text className="px-1 text-micro-label uppercase text-muted-foreground">Or</Text>}
        <ListGroup>
          <ListItem
            disabled={creating}
            className={cn('items-center gap-3', creating && 'opacity-50')}
            onPress={() => {
              haptics.select();
              onCreateHousehold();
            }}
            accessibilityRole="button"
          >
            <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
              <Plus size={18} className="text-foreground" />
            </View>
            <ListItemContent>
              <ListItemTitle>{creating ? 'Starting your household…' : 'Start a new household'}</ListItemTitle>
              <ListItemMeta>
                <Text className="text-caption text-muted-foreground">You can invite people after</Text>
              </ListItemMeta>
            </ListItemContent>
            <ListItemTrailing className="mt-0">
              <ChevronRight size={16} className="text-muted-foreground" />
            </ListItemTrailing>
          </ListItem>
        </ListGroup>
      </View>
    </View>
  );
}
