"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsInset, SettingsLabel, SettingsPanel } from "@/components/settings-panel";
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XIcon, UsersIcon, MailIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AcceptInvitationDialog } from "@/components/accept-invitation-dialog";
import { OfflineHint } from "@/components/offline-hint";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import {
  timeAgo,
  regionsToOptions,
  hasCuratedContent,
  DEFAULT_REGION,
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
import { dialog } from '@homeup/core';
import type { GroupInvitation } from '@homeup/core';

export function GroupManager() {
  const { group, groupMembers, memberProfiles, isGroupOwner, currentUserId, sentInvitations, pendingInvitations, isOnline, refresh } = useDataCache();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(group?.name ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [acceptingInvite, setAcceptingInvite] = useState<GroupInvitation | null>(null);
  const [invitedProfiles, setInvitedProfiles] = useState<Record<string, string>>({});
  const [savingRegion, setSavingRegion] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);

  // 250 options, so this is a SearchablePicker rather than a <select> per
  // Hearth's picker convention. Built once: Intl.DisplayNames is not cheap.
  const regionOptions = useMemo(() => regionsToOptions(), []);
  const regionCurrency = currencyForCountry(group?.region || DEFAULT_REGION);
  const currencyOptions = useMemo(() => currencyPickerOptions(regionCurrency), [regionCurrency]);

  useEffect(() => {
    if (sentInvitations.length === 0) return;
    fetchProfileLabels(createClient(), sentInvitations.map((inv) => inv.invited_user_id)).then((labels) => {
      if (labels) setInvitedProfiles(labels);
    });
  }, [sentInvitations]);

  if (!group) {
    if (pendingInvitations.length === 0) return null;
    return (
      <>
        <PendingInvitationsPanel
          invitations={pendingInvitations}
          onAccept={setAcceptingInvite}
          onDecline={(id) => handleDecline(id)}
        />
        {acceptingInvite && (
          <AcceptInvitationDialog
            invitation={acceptingInvite}
            open={!!acceptingInvite}
            onClose={() => setAcceptingInvite(null)}
          />
        )}
      </>
    );
  }

  const handleRename = async () => {
    if (!name.trim() || name.trim() === group.name) {
      setEditingName(false);
      return;
    }
    const error = await renameGroup(createClient(), group.id, name.trim());
    if (error) {
      toast.error("Failed to rename group");
    } else {
      toast.success("Group renamed");
      refresh();
    }
    setEditingName(false);
  };

  const handleRegionChange = async (nextRegion: string) => {
    if (nextRegion === (group.region || DEFAULT_REGION)) return;
    setSavingRegion(true);
    const error = await setGroupRegion(createClient(), group.id, nextRegion);
    if (error) {
      // Surface the real error: the region column is check-constrained, so a
      // generic message here hides the one thing worth knowing when it fails.
      toast.error(`Failed to update region: ${error.message}`);
    } else {
      toast.success("Region updated");
      refresh();
    }
    setSavingRegion(false);
  };

  const handleCurrencyChange = async (next: string) => {
    const nextCurrency = next === FOLLOW_REGION_CURRENCY ? null : next;
    if (nextCurrency === (group.currency ?? null)) return;
    setSavingCurrency(true);
    const error = await setGroupCurrency(createClient(), group.id, nextCurrency);
    if (error) {
      toast.error(`Failed to update currency: ${error.message}`);
    } else {
      toast.success("Currency updated");
      refresh();
    }
    setSavingCurrency(false);
  };

  const handleInvite = async () => {
    if (!isOnline) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);

    const result = await inviteToGroup(createClient(), {
      groupId: group.id,
      invitedBy: currentUserId,
      email,
      memberIds: groupMembers.map((m) => m.user_id),
      invitedIds: sentInvitations.map((inv) => inv.invited_user_id),
    });

    if (result !== "sent") {
      toast.error(GROUP_INVITE_ERRORS[result]);
    } else {
      toast.success(`Invitation sent to ${email}`);
      setInviteEmail("");
      refresh();
    }
    setInviting(false);
  };

  const handleCancelInvite = async (invitationId: string) => {
    const error = await cancelGroupInvitation(createClient(), invitationId);
    if (error) {
      toast.error("Failed to cancel invitation");
    } else {
      toast.success("Invitation cancelled");
      refresh();
    }
  };

  const handleDecline = async (invitationId: string) => {
    const error = await declineGroupInvitation(createClient(), invitationId);
    if (error) {
      toast.error("Failed to decline invitation");
    } else {
      toast.success("Invitation declined");
      refresh();
    }
  };

  const handleRemove = async (userId: string) => {
    if (!(await dialog.confirm({ title: "Remove this member from the group?", confirmLabel: "Remove", destructive: true }))) return;
    const error = await removeGroupMember(createClient(), group.id, userId);
    if (error) {
      toast.error("Failed to remove member");
    } else {
      toast.success("Member removed");
      refresh();
    }
  };

  return (
    <>
      {pendingInvitations.length > 0 && (
        <PendingInvitationsPanel
          invitations={pendingInvitations}
          onAccept={setAcceptingInvite}
          onDecline={handleDecline}
        />
      )}

      <SettingsPanel
        icon={UsersIcon}
        title={
          editingName ? (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 min-w-0 flex-1 font-sans text-sm font-normal"
                aria-label="Household name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
              />
              <Button size="icon" variant="ghost" onClick={handleRename} aria-label="Save name">
                <CheckIcon className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditingName(false)} aria-label="Cancel rename">
                <XIcon className="h-4 w-4" />
              </Button>
            </span>
          ) : (
            <>
              <span className="truncate">{group.name}</span>
              {isGroupOwner && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => { setName(group.name); setEditingName(true); }}
                  aria-label="Rename household"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )
        }
        action={
          editingName ? undefined : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {groupMembers.length} member{groupMembers.length !== 1 ? "s" : ""}
            </span>
          )
        }
      >
        <SettingsInset>
          {groupMembers.map((member) => {
            const profile = memberProfiles[member.user_id];
            const displayName = profile?.name ?? profile?.email ?? member.user_id;
            const initial = (profile?.name ?? profile?.email ?? "?")[0].toUpperCase();
            const isYou = member.user_id === currentUserId;
            return (
              <div key={member.user_id} className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5">
                {/* People's identity is the avatar; the accent ring marks you
                    (Hearth §3), never a tinted fill. */}
                {profile?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar}
                    alt=""
                    className={cn("h-8 w-8 rounded-full shrink-0 object-cover", isYou && "ring-2 ring-primary ring-offset-2 ring-offset-card")}
                  />
                ) : (
                  <div
                    className={cn(
                      "h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0",
                      isYou && "ring-2 ring-primary ring-offset-2 ring-offset-card"
                    )}
                  >
                    <span className="text-xs font-semibold text-muted-foreground">{initial}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium">{displayName}</span>
                  {profile?.name && profile?.email && (
                    <span className="text-xs text-muted-foreground truncate block">{profile.email}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                {isGroupOwner && member.role !== "owner" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(member.user_id)}
                    aria-label={`Remove ${displayName}`}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </SettingsInset>

        {/* Region: drives currency formatting everywhere, plus curated
            local content (retailers, listing sources, moving checklist,
            grocery staples) for the countries that have it. */}
        <div className="space-y-1.5">
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
              <p className="px-1 text-xs text-muted-foreground">
                {hasCuratedContent(group.region || DEFAULT_REGION)
                  ? "Local shopping and moving suggestions included"
                  : "No local shopping or moving suggestions here yet"}
              </p>
            </>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
              <span className="text-sm font-medium">
                {regionOptions.find((o) => o.value === (group.region || DEFAULT_REGION))?.primary ?? group.region}
              </span>
            </div>
          )}
        </div>

        {/* Currency: what money is shown in. Defaults to the region's, and
            only relabels amounts, never converts them. */}
        <div className="space-y-1.5">
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
              <p className="px-1 text-xs text-muted-foreground">
                Switching relabels amounts already entered. It doesn&apos;t convert them
              </p>
            </>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
              <span className="text-sm font-medium tabular-nums">{householdCurrency(group)}</span>
            </div>
          )}
        </div>

        {isGroupOwner && sentInvitations.length > 0 && (
          <div className="space-y-1.5">
            <SettingsLabel>Invited</SettingsLabel>
            <SettingsInset>
              {sentInvitations.map((inv) => (
                <div key={inv.id} className="flex min-h-[48px] items-center justify-between gap-2 px-3.5 py-1.5">
                  <span className="text-sm text-muted-foreground truncate">
                    {invitedProfiles[inv.invited_user_id] ?? inv.invited_user_id.slice(0, 8) + "…"}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 text-muted-foreground hover:text-destructive"
                    onClick={() => handleCancelInvite(inv.id)}
                    aria-label="Cancel invitation"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </SettingsInset>
          </div>
        )}

        {isGroupOwner && (
          <div className="space-y-1.5">
            <SettingsLabel>Invite</SettingsLabel>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-9 flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                disabled={!isOnline}
                aria-label="Invite by email"
              />
              <Button
                size="lg"
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim() || !isOnline}
                className="px-3"
              >
                <PlusIcon className="h-4 w-4" />
                Invite
              </Button>
            </div>
            {!isOnline && <OfflineHint />}
          </div>
        )}
      </SettingsPanel>

      {acceptingInvite && (
        <AcceptInvitationDialog
          invitation={acceptingInvite}
          open={!!acceptingInvite}
          onClose={() => setAcceptingInvite(null)}
        />
      )}
    </>
  );
}

function PendingInvitationsPanel({
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
    <SettingsPanel icon={MailIcon} title="Pending invitations">
      <SettingsInset>
        {invitations.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-2 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{inv.group_name ?? "A group"}</p>
              <p className="text-xs text-muted-foreground">Invited {timeAgo(inv.created_at)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="lg" variant="outline" onClick={() => onDecline(inv.id)}>
                Decline
              </Button>
              <Button size="lg" onClick={() => onAccept(inv)}>
                Accept
              </Button>
            </div>
          </div>
        ))}
      </SettingsInset>
    </SettingsPanel>
  );
}
