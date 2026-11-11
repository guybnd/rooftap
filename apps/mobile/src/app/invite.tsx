// The owner's invite screen on the phone (independent review n1). Web twin:
// apps/web/src/app/invite/page.tsx. One link per home, its QR code (drawn by
// @homeup/ui's CardCode, no native module) and the system share sheet. The
// person who opens the link joins on the web page /join/<token>, with or
// without an account. Home's first-week card links here.
import * as React from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { Button, CardCode, ScreenBackground, Text, haptics, toast } from '@homeup/ui';
import { INVITE_COPY, dialog, fetchInviteLink, inviteLinkLifeLabel, inviteUrl, stopInviteLink, useModules, type InviteLink } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const modules = useModules();
  const { group, isGroupOwner, groupMembers } = useDataCache();
  const [origin, setOrigin] = React.useState<string | null>(null);
  const [link, setLink] = React.useState<InviteLink | null | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const supported = modules.server('household.invite-links');

  React.useEffect(() => {
    getStoredServer().then((s) => setOrigin(s?.origin ?? null));
  }, []);

  React.useEffect(() => {
    if (!group?.id || !isGroupOwner || !supported) return;
    let live = true;
    fetchInviteLink(getCurrentSupabaseClient(), group.id).then((l) => {
      if (live) setLink(l);
    });
    return () => {
      live = false;
    };
  }, [group?.id, isGroupOwner, supported]);

  const url = link && origin ? inviteUrl(origin, link.token) : null;

  const share = async () => {
    if (!url || !group) return;
    haptics.select();
    await Share.share({ message: INVITE_COPY.share(group.name, url) }).catch(() => {});
  };

  const renew = async () => {
    if (!group) return;
    if (!(await dialog.confirm({ title: INVITE_COPY.renewConfirm, confirmLabel: 'Make new link' }))) return;
    setBusy(true);
    const next = await fetchInviteLink(getCurrentSupabaseClient(), group.id, true);
    setBusy(false);
    if (!next) toast.error('Could not make a new link');
    else setLink(next);
  };

  const stop = async () => {
    if (!group) return;
    if (!(await dialog.confirm({ title: INVITE_COPY.stopConfirm, confirmLabel: 'Turn off', destructive: true }))) return;
    setBusy(true);
    const ok = await stopInviteLink(getCurrentSupabaseClient(), group.id);
    setBusy(false);
    if (!ok) toast.error('Could not turn the link off');
    else setLink(null);
  };

  const lede = !supported
    ? 'This server is too old for invite links. Invite people by email in Settings, then Home.'
    : isGroupOwner
      ? INVITE_COPY.lede
      : INVITE_COPY.notOwner;

  return (
    <ScreenBackground style={{ paddingTop: insets.top }}>
      {/* M2: the back control is a full 44px target. */}
      <View className="flex-row items-center gap-1 px-2 pb-1 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="size-11 items-center justify-center rounded-full active:bg-accent/40"
        >
          <ArrowLeft size={20} className="text-muted-foreground" />
        </Pressable>
        <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
          {INVITE_COPY.title}
        </Text>
      </View>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-12 pt-2">
        <Text className="text-body text-muted-foreground">{lede}</Text>

        {supported && isGroupOwner && link === null && (
          <View className="gap-3 rounded-2xl border border-border bg-card p-4">
            <Text className="text-body text-muted-foreground">The link is off. Nobody can join with it.</Text>
            <Button size="lg" onPress={renew} disabled={busy}>
              Make a link
            </Button>
          </View>
        )}

        {supported && isGroupOwner && url && link && (
          <>
            <CardCode number={url} format="qr" />
            <View className="gap-1 rounded-xl border border-border bg-card px-3.5 py-3">
              <Text selectable className="font-mono text-caption text-foreground">
                {url}
              </Text>
              <Text className="text-caption text-muted-foreground">{inviteLinkLifeLabel(link.expiresAt)}</Text>
            </View>
            <Button size="lg" className="h-12" onPress={share}>
              Share link
            </Button>
            <Text className="text-caption tabular-nums text-muted-foreground">
              {groupMembers.length === 1 ? 'You are the only one here so far.' : `${groupMembers.length} people live here.`}
            </Text>
            <View className="flex-row gap-5">
              <Pressable onPress={renew} disabled={busy} accessibilityRole="button" hitSlop={8} className="active:opacity-70">
                <Text className="text-body text-muted-foreground">Make a new link</Text>
              </Pressable>
              <Pressable onPress={stop} disabled={busy} accessibilityRole="button" hitSlop={8} className="active:opacity-70">
                <Text className="text-body text-destructive">Turn link off</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
