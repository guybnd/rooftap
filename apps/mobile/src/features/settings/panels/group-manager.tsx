// HOUP-84: native port of apps/web/src/components/group-manager.tsx. Zero-prop
// settings panel (see settings-content.tsx contract) driven by useDataCache()
// (group, groupMembers, memberProfiles, isGroupOwner, currentUserId,
// sentInvitations, pendingInvitations, isOnline, refresh — all added to the
// native DataCacheProvider for this ticket). Mutations go through
// @homeup/core's data/group-admin.ts helpers (shared with web), followed by
// refresh().
//
// HOUP-139: rename/remove/cancel-invite now surface via the universal toast
// host instead of Alert.alert-on-failure-only — mirrors web group-manager.tsx's
// sonner copy ("Group renamed" / "Member removed" / "Invitation cancelled").
// Destructive confirms still use Alert.alert's native action-sheet-style
// buttons instead of `window.confirm`. Member rows/pending-invite rows/sent-
// invite rows are rebuilt on @homeup/ui's ListGroup/ListItem three-slot
// anatomy (Hearth) rather than web's raw `divide-y` rows.
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Check, Mail, Pencil, Plus, Trash2, Users, WifiOff, X } from 'lucide-react-native';
import {
  Text,
  Button,
  Input,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  SearchablePicker,
  cn,
  toast,
  haptics,
} from '@homeup/ui';
import {
  timeAgo,
  regionsToOptions,
  hasCuratedContent,
  DEFAULT_REGION,
  type GroupInvitation,
  GROUP_INVITE_ERRORS,
  cancelGroupInvitation,
  declineGroupInvitation,
  fetchProfileLabels,
  inviteToGroup,
  removeGroupMember,
  renameGroup,
  setGroupRegion,
  setGroupCurrency,
  householdCurrency,
  currencyForCountry,
  currencyPickerOptions,
  FOLLOW_REGION_CURRENCY,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { AcceptInvitationDialog } from './accept-invitation-dialog';
import { SettingsInset, SettingsLabel, SettingsPanel } from './settings-panel';

export function GroupManager() {
  const {
    group,
    groupMembers,
    memberProfiles,
    isGroupOwner,
    currentUserId,
    sentInvitations,
    pendingInvitations,
    isOnline,
    refresh,
  } = useDataCache();

  const [editingName, setEditingName] = React.useState(false);
  const [name, setName] = React.useState(group?.name ?? '');
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviting, setInviting] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [acceptingInvite, setAcceptingInvite] = React.useState<GroupInvitation | null>(null);
  const [invitedProfiles, setInvitedProfiles] = React.useState<Record<string, string>>({});
  const [savingRegion, setSavingRegion] = React.useState(false);
  const [savingCurrency, setSavingCurrency] = React.useState(false);

  // 250 options, so this is a SearchablePicker rather than an inline list per
  // Hearth's picker convention. Built once: Intl.DisplayNames is not cheap.
  const regionOptions = React.useMemo(() => regionsToOptions(), []);
  const regionCurrency = currencyForCountry(group?.region || DEFAULT_REGION);
  const currencyOptions = React.useMemo(() => currencyPickerOptions(regionCurrency), [regionCurrency]);

  React.useEffect(() => {
    if (sentInvitations.length === 0) return;
    fetchProfileLabels(getCurrentSupabaseClient(), sentInvitations.map((inv) => inv.invited_user_id)).then((labels) => {
      if (labels) setInvitedProfiles(labels);
    });
  }, [sentInvitations]);

  const handleDecline = async (invitationId: string) => {
    const error = await declineGroupInvitation(getCurrentSupabaseClient(), invitationId);
    if (error) {
      haptics.error();
      Alert.alert('Failed to decline invitation');
      return;
    }
    await refresh();
  };

  if (!group) {
    if (pendingInvitations.length === 0) return null;
    return (
      <>
        <PendingInvitationsCard
          invitations={pendingInvitations}
          onAccept={setAcceptingInvite}
          onDecline={handleDecline}
        />
        {acceptingInvite && (
          <AcceptInvitationDialog
            invitation={acceptingInvite}
            onAccept={() => setAcceptingInvite(null)}
            onDecline={() => setAcceptingInvite(null)}
          />
        )}
      </>
    );
  }

  const handleRegionChange = async (nextRegion: string) => {
    if (nextRegion === (group.region || DEFAULT_REGION)) return;
    setSavingRegion(true);
    const error = await setGroupRegion(getCurrentSupabaseClient(), group.id, nextRegion);
    if (error) {
      // Surface the real error: the region column is check-constrained, so a
      // generic message hides the one thing worth knowing when it fails.
      toast.error(`Failed to update region: ${error.message}`);
    } else {
      await refresh();
      toast.success('Region updated');
    }
    setSavingRegion(false);
  };

  const handleCurrencyChange = async (next: string) => {
    const nextCurrency = next === FOLLOW_REGION_CURRENCY ? null : next;
    if (nextCurrency === (group.currency ?? null)) return;
    setSavingCurrency(true);
    const error = await setGroupCurrency(getCurrentSupabaseClient(), group.id, nextCurrency);
    if (error) {
      toast.error(`Failed to update currency: ${error.message}`);
    } else {
      await refresh();
      toast.success('Currency updated');
    }
    setSavingCurrency(false);
  };

  const handleRename = async () => {
    if (!name.trim() || name.trim() === group.name) {
      setEditingName(false);
      return;
    }
    const error = await renameGroup(getCurrentSupabaseClient(), group.id, name.trim());
    if (error) {
      toast.error('Failed to rename group');
    } else {
      await refresh();
      toast.success('Group renamed');
    }
    setEditingName(false);
  };

  const handleInvite = async () => {
    if (!isOnline) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    setInviteError(null);

    const result = await inviteToGroup(getCurrentSupabaseClient(), {
      groupId: group.id,
      invitedBy: currentUserId,
      email,
      memberIds: groupMembers.map((m) => m.user_id),
      invitedIds: sentInvitations.map((inv) => inv.invited_user_id),
    });

    if (result !== 'sent') {
      setInviteError(GROUP_INVITE_ERRORS[result]);
    } else {
      setInviteEmail('');
      await refresh();
    }
    setInviting(false);
  };

  const handleCancelInvite = async (invitationId: string) => {
    const error = await cancelGroupInvitation(getCurrentSupabaseClient(), invitationId);
    if (error) {
      toast.error('Failed to cancel invitation');
    } else {
      await refresh();
      toast.success('Invitation cancelled');
    }
  };

  const handleRemove = (userId: string) => {
    haptics.warn();
    Alert.alert('Remove this member from the group?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const error = await removeGroupMember(getCurrentSupabaseClient(), group.id, userId);
          if (error) {
            toast.error('Failed to remove member');
          } else {
            await refresh();
            toast.success('Member removed');
          }
        },
      },
    ]);
  };

  return (
    <>
      {pendingInvitations.length > 0 && (
        <PendingInvitationsCard
          invitations={pendingInvitations}
          onAccept={setAcceptingInvite}
          onDecline={handleDecline}
        />
      )}

      <SettingsPanel
        icon={Users}
        title={
          editingName ? (
            <View className="min-w-0 flex-1 flex-row items-center gap-1">
              <Input
                value={name}
                onChangeText={setName}
                className="h-9 min-w-0 flex-1"
                accessibilityLabel="Household name"
                autoFocus
                onSubmitEditing={handleRename}
                returnKeyType="done"
              />
              <Button size="icon-sm" variant="ghost" onPress={handleRename} accessibilityLabel="Save name">
                <Check size={16} className="text-foreground" />
              </Button>
              <Button size="icon-sm" variant="ghost" onPress={() => setEditingName(false)} accessibilityLabel="Cancel rename">
                <X size={16} className="text-foreground" />
              </Button>
            </View>
          ) : (
            <>
              <Text numberOfLines={1} className="shrink font-heading text-title font-semibold text-foreground">
                {group.name}
              </Text>
              {isGroupOwner && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onPress={() => {
                    setName(group.name);
                    setEditingName(true);
                  }}
                  accessibilityLabel="Rename household"
                >
                  <Pencil size={14} className="text-muted-foreground" />
                </Button>
              )}
            </>
          )
        }
        action={
          editingName ? undefined : (
            <Text className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {groupMembers.length} member{groupMembers.length !== 1 ? 's' : ''}
            </Text>
          )
        }
      >
        <SettingsInset>
          {groupMembers.map((member) => {
            const profile = memberProfiles[member.user_id];
            const displayName = profile?.name ?? profile?.email ?? member.user_id;
            const initial = (profile?.name ?? profile?.email ?? '?')[0]!.toUpperCase();
            const isYou = member.user_id === currentUserId;
            return (
              <ListItem key={member.user_id} className="min-h-[56px] items-center px-3.5">
                {/* People's identity is the avatar; an accent ring marks you
                    (Hearth §3), never a tinted fill. */}
                <ListItemLeading className="mt-0">
                  <View className={cn('rounded-full p-0.5', isYou ? 'border-2 border-primary' : 'border-2 border-transparent')}>
                    <View className="size-8 items-center justify-center rounded-full bg-muted">
                      <Text className="text-xs font-semibold text-muted-foreground">{initial}</Text>
                    </View>
                  </View>
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                      {displayName}
                    </Text>
                  </ListItemTitle>
                  {profile?.name && profile?.email && (
                    <ListItemMeta>
                      <Text numberOfLines={1} className="text-caption text-muted-foreground">
                        {profile.email}
                      </Text>
                    </ListItemMeta>
                  )}
                </ListItemContent>
                <ListItemTrailing className="mt-0">
                  <Text className="text-xs capitalize text-muted-foreground">{member.role}</Text>
                  {isGroupOwner && member.role !== 'owner' && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="-mr-2"
                      onPress={() => handleRemove(member.user_id)}
                      accessibilityLabel={`Remove ${displayName}`}
                    >
                      <Trash2 size={15} className="text-muted-foreground" />
                    </Button>
                  )}
                </ListItemTrailing>
              </ListItem>
            );
          })}
        </SettingsInset>

        {/* Region: drives currency formatting everywhere, plus curated local
            content (retailers, listing sources, moving checklist, grocery
            staples) for the countries that have it. */}
        <View className="gap-1.5">
          <SettingsLabel>Region</SettingsLabel>
          {isGroupOwner ? (
            <>
              <SearchablePicker
                options={regionOptions}
                value={group.region || DEFAULT_REGION}
                onChange={handleRegionChange}
                disabled={savingRegion || !isOnline}
                placeholder="Select a region"
                searchPlaceholder="Search countries"
                emptyText="No matching country"
                ariaLabel="Household region"
              />
              <Text className="px-1 text-caption text-muted-foreground">
                {hasCuratedContent(group.region || DEFAULT_REGION)
                  ? 'Local shopping and moving suggestions included'
                  : 'No local shopping or moving suggestions here yet'}
              </Text>
            </>
          ) : (
            <View className="flex-row items-center gap-2 self-start rounded-lg bg-muted/40 px-3 py-1.5">
              <Text className="text-sm font-medium text-foreground">
                {regionOptions.find((o) => o.value === (group.region || DEFAULT_REGION))?.primary ?? group.region}
              </Text>
            </View>
          )}
        </View>

        {/* Currency: what money is shown in. Defaults to the region's, and
            only relabels amounts, never converts them. */}
        <View className="gap-1.5">
          <SettingsLabel>Currency</SettingsLabel>
          {isGroupOwner ? (
            <>
              <SearchablePicker
                options={currencyOptions}
                value={group.currency ?? FOLLOW_REGION_CURRENCY}
                onChange={handleCurrencyChange}
                disabled={savingCurrency || !isOnline}
                placeholder="Select a currency"
                searchPlaceholder="Search currencies"
                emptyText="No matching currency"
                ariaLabel="Household currency"
              />
              <Text className="px-1 text-caption text-muted-foreground">
                Switching relabels amounts already entered. It doesn't convert them
              </Text>
            </>
          ) : (
            <View className="flex-row items-center gap-2 self-start rounded-lg bg-muted/40 px-3 py-1.5">
              <Text className="text-sm font-medium tabular-nums text-foreground">{householdCurrency(group)}</Text>
            </View>
          )}
        </View>

        {isGroupOwner && sentInvitations.length > 0 && (
          <View className="gap-1.5">
            <SettingsLabel>Invited</SettingsLabel>
            <SettingsInset>
              {sentInvitations.map((inv) => (
                <ListItem key={inv.id} className="min-h-12 items-center px-3.5 py-1.5">
                  <ListItemContent>
                    <Text numberOfLines={1} className="text-sm text-muted-foreground">
                      {invitedProfiles[inv.invited_user_id] ?? `${inv.invited_user_id.slice(0, 8)}…`}
                    </Text>
                  </ListItemContent>
                  <ListItemTrailing className="mt-0">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="-mr-2"
                      onPress={() => handleCancelInvite(inv.id)}
                      accessibilityLabel="Cancel invitation"
                    >
                      <X size={15} className="text-muted-foreground" />
                    </Button>
                  </ListItemTrailing>
                </ListItem>
              ))}
            </SettingsInset>
          </View>
        )}

        {isGroupOwner && (
          <View className="gap-1.5">
            <SettingsLabel>Invite</SettingsLabel>
            <View className="flex-row items-center gap-2">
              <Input
                placeholder="Email address"
                value={inviteEmail}
                onChangeText={setInviteEmail}
                className="h-9 min-w-0 flex-1"
                onSubmitEditing={handleInvite}
                returnKeyType="done"
                editable={isOnline}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel="Invite by email"
              />
              <Button size="sm" className="px-3" onPress={handleInvite} disabled={inviting || !inviteEmail.trim() || !isOnline}>
                <Plus size={14} className="text-primary-foreground" />
                <Text className="text-sm font-medium text-primary-foreground">Invite</Text>
              </Button>
            </View>
            {!isOnline && (
              <View className="flex-row items-center gap-1 px-1">
                <WifiOff size={12} className="shrink-0 text-muted-foreground" />
                <Text className="text-caption text-muted-foreground">Needs a connection</Text>
              </View>
            )}
            {inviteError && <Text className="px-1 text-caption text-destructive">{inviteError}</Text>}
          </View>
        )}
      </SettingsPanel>

      {acceptingInvite && (
        <AcceptInvitationDialog
          invitation={acceptingInvite}
          onAccept={() => setAcceptingInvite(null)}
          onDecline={() => setAcceptingInvite(null)}
        />
      )}
    </>
  );
}

function PendingInvitationsCard({
  invitations,
  onAccept,
  onDecline,
}: {
  invitations: GroupInvitation[];
  onAccept: (inv: GroupInvitation) => void;
  onDecline: (invitationId: string) => void;
}) {
  // H2: a neutral panel, not a coral-tinted callout. Accept is this view's
  // one primary action.
  return (
    <SettingsPanel icon={Mail} title="Pending invitations">
      <SettingsInset>
        {invitations.map((inv) => (
          <ListItem key={inv.id} className="items-center px-3.5">
            <ListItemContent>
              <ListItemTitle>{inv.group_name ?? 'A group'}</ListItemTitle>
              <ListItemMeta>
                <Text className="text-caption text-muted-foreground">Invited {timeAgo(inv.created_at)}</Text>
              </ListItemMeta>
            </ListItemContent>
            <ListItemTrailing className="mt-0 gap-1.5">
              <Button size="sm" variant="outline" onPress={() => onDecline(inv.id)}>
                Decline
              </Button>
              <Button size="sm" onPress={() => onAccept(inv)}>
                Accept
              </Button>
            </ListItemTrailing>
          </ListItem>
        ))}
      </SettingsInset>
    </SettingsPanel>
  );
}
