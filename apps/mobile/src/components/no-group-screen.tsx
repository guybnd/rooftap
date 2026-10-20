// HOUP-179: full-screen wrapper around @homeup/ui's NoGroupState — wires the
// presentational component to mobile's DataCacheProvider (pendingInvitations,
// and refresh() as the create-household action: fetchGroupData already
// auto-creates a group for any authenticated user with no membership, so
// re-running it via refresh() is the create action, no separate insert
// needed) and to the existing accept/decline flow (AcceptInvitationDialog,
// HOUP-84). Every one of the 20 `if (!group)` dead ends renders this.
import * as React from 'react';
import { NoGroupState, ScreenBackground } from '@homeup/ui';
import type { GroupInvitation } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { AcceptInvitationDialog } from '@/features/settings/panels/accept-invitation-dialog';

export function NoGroupScreen() {
  const { pendingInvitations, refresh } = useDataCache();
  const [creating, setCreating] = React.useState(false);
  const [reviewingInvite, setReviewingInvite] = React.useState<GroupInvitation | null>(null);

  const handleCreateHousehold = async () => {
    setCreating(true);
    await refresh();
    setCreating(false);
  };

  return (
    <ScreenBackground className="items-center justify-center p-6">
      <NoGroupState
        pendingInvitations={pendingInvitations}
        creating={creating}
        onCreateHousehold={handleCreateHousehold}
        onReviewInvite={setReviewingInvite}
      />
      {reviewingInvite && (
        <AcceptInvitationDialog
          invitation={reviewingInvite}
          onAccept={() => setReviewingInvite(null)}
          onDecline={() => setReviewingInvite(null)}
        />
      )}
    </ScreenBackground>
  );
}
