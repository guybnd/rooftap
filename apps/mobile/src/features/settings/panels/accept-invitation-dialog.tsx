// HOUP-84: native port of apps/web/src/components/accept-invitation-dialog.tsx,
// rebuilt on @homeup/ui's BottomSheet (no "Dialog" primitive exists on
// native — decided, see ticket contract). On web this is invoked from
// app/homesearch/page.tsx (not from a settings screen); that mount site maps
// to apps/mobile/src/app/(tabs)/homesearch/index.tsx, which belongs to HOUP-78
// (Apartments/search port, not yet built on mobile). This ticket's job is
// only to build and export a correct, reusable AcceptInvitationDialog — it is
// intentionally NOT wired into any screen yet. group-manager.tsx (the other
// file in this ticket) DOES render it, exactly like web's GroupManager does.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { ArrowRightLeft, Trash2 } from 'lucide-react-native';
import { Text, BottomSheet, Button } from '@homeup/ui';
import {
  apartments$,
  agents$,
  apartmentChecklistItems$,
  savedSearches$,
  useReconnectSync,
  type Agent,
  type Apartment,
  type ChecklistItem,
  type GroupInvitation,
  type SavedSearch,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export interface AcceptInvitationDialogProps {
  invitation: GroupInvitation;
  onAccept?: () => void;
  onDecline?: () => void;
}

export function AcceptInvitationDialog({ invitation, onAccept, onDecline }: AcceptInvitationDialogProps) {
  const [processing, setProcessing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { group, refresh } = useDataCache();

  const apts$ = apartments$(group?.id);
  const agentsStore$ = agents$(group?.id);
  const checklistItemsStore$ = apartmentChecklistItems$(group?.id);
  const savedSearchesStore$ = savedSearches$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(savedSearchesStore$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((c): c is ChecklistItem => !!c && !c.deleted)
  );
  const savedSearches = use$(() =>
    Object.values(savedSearchesStore$.get() ?? {}).filter((s): s is SavedSearch => !!s && !s.deleted)
  );

  const handleAccept = async (mode: 'merge' | 'abandon') => {
    setProcessing(true);
    setError(null);
    const supabase = getCurrentSupabaseClient();
    const rpcName = mode === 'merge' ? 'accept_invitation_merge' : 'accept_invitation_abandon';
    const { error: rpcError } = await supabase.rpc(rpcName, { invitation_id: invitation.id });
    if (rpcError) {
      setError('Failed to accept invitation');
      setProcessing(false);
      return;
    }
    await refresh();
    setProcessing(false);
    onAccept?.();
  };

  const dataCount = apartments.length + agents.length + checklistItems.length + savedSearches.length;

  return (
    <BottomSheet open onOpenChange={(open) => { if (!open) onDecline?.(); }}>
      <View className="gap-4 px-4 pb-2 pt-1">
        <View className="gap-1">
          <Text className="font-heading text-title font-semibold text-foreground">
            Join {invitation.group_name ?? 'Group'}
          </Text>
          <Text className="text-body text-muted-foreground">
            Choose how to handle your existing data ({dataCount} item{dataCount !== 1 ? 's' : ''}).
          </Text>
        </View>

        <View className="gap-3">
          <Pressable
            disabled={processing}
            onPress={() => handleAccept('merge')}
            className="rounded-lg border border-primary/30 bg-primary/5 p-3 disabled:opacity-50"
            accessibilityRole="button"
          >
            <View className="flex-row items-center gap-2">
              <ArrowRightLeft size={16} className="text-primary" />
              <Text className="text-sm font-medium text-foreground">Merge Data</Text>
            </View>
            <Text className="mt-1 text-xs text-muted-foreground">
              Move all your apartments ({apartments.length}), agents ({agents.length}), checklist items (
              {checklistItems.length}), and saved searches ({savedSearches.length}) into the new group.
            </Text>
          </Pressable>

          <Pressable
            disabled={processing}
            onPress={() => handleAccept('abandon')}
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 disabled:opacity-50"
            accessibilityRole="button"
          >
            <View className="flex-row items-center gap-2">
              <Trash2 size={16} className="text-destructive" />
              <Text className="text-sm font-medium text-foreground">Start Fresh</Text>
            </View>
            <Text className="mt-1 text-xs text-muted-foreground">
              Delete all your existing data and join the group with a clean slate. This cannot be undone.
            </Text>
          </Pressable>
        </View>

        {error && <Text className="text-xs text-destructive">{error}</Text>}

        <Button variant="outline" onPress={() => onDecline?.()} disabled={processing}>
          Cancel
        </Button>
      </View>
    </BottomSheet>
  );
}
