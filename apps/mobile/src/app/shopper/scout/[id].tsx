// HOUP-435: one Scout run. While it researches, the head says so; once done
// the Hero counts the picks ("3 picks under $2,000", H1) with the stores
// checked and when, and each pick is a §6 row: rank, title, its role, store
// and stock, today's price trailing. A pick opens its sheet: why it fits,
// every source behind it, and the actions. Web twin:
// apps/web/src/app/shopper/scout/[id]/page.tsx.
//
// Scout threads: the run is also a conversation. One composer at the bottom
// takes a question about the picks or a change to the search; Scout answers
// in words, or says what it changed and searches again, and the new picks
// land further down with the Hero counting them. The ghost reply, reply text
// and composer are Assistant's, so the two read alike, but the thread is
// stored with the run and works with Assistant off.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Archive, ArchiveRestore, ArrowLeft, ExternalLink, MessageCircle, Trash2, X } from 'lucide-react-native';
import {
  BottomSheet,
  Button,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  Text,
  toast,
} from '@homeup/ui';
import {
  archiveScoutRun,
  deleteScoutRun,
  formatMoney,
  scoutBudgetLabel,
  scoutFailure,
  scoutHeadline,
  scoutPickAskLabel,
  scoutRunStatus,
  scoutStoresCaption,
  scoutTitle,
  timeAgo,
  useModules,
  useScoutThread,
  MOTION_DURATIONS_MS,
  SCOUT_FOLLOW_UP_MAX,
  type ScoutMessage,
  type ShopperPick,
  type ShopperSearch,
  unarchiveScoutRun,
} from '@homeup/core';
import { scoutRun, sendScoutFollowUp, updateScoutRun, watchScoutPick } from '@/features/shopper/shopper-api';
import { archiveToast } from '@/lib/archive-toast';
import { Composer, ReplyText, Thinking } from '@/features/assistant/assistant-parts';

const API = { load: scoutRun, send: sendScoutFollowUp };

export default function ScoutRunScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const modules = useModules();
  const canTalk = modules.server('shopper.scout-thread');
  const canArchive = modules.server('shopper.scout-archive');
  const { thread, root, latest, latestPicks, items, suggestions, pending, send, refresh } = useScoutThread(id, API);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [about, setAbout] = React.useState<ShopperPick | null>(null);
  // Remounts the composer so it takes focus after "Ask Scout about this".
  const [composerKey, setComposerKey] = React.useState(0);
  const scrollRef = React.useRef<ScrollView>(null);

  const openPick = (pick: ShopperPick) => {
    setOpenId(pick.id);
    setSheetOpen(true);
  };
  const closePick = () => {
    setSheetOpen(false);
    setTimeout(() => setOpenId(null), MOTION_DURATIONS_MS.exit);
  };

  if (thread === undefined) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (thread === null || !root || !latest) {
    return (
      <ScreenBackground className="items-center justify-center gap-3 p-6">
        <Text className="text-muted-foreground">Scout run not found.</Text>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <Text className="text-sm font-medium text-foreground">Back to Shopper</Text>
        </Button>
      </ScreenBackground>
    );
  }

  const status = scoutRunStatus(latest);
  const budget = scoutBudgetLabel(latest.brief);
  const headline = scoutHeadline(latestPicks, latest.brief);
  const caption = [scoutStoresCaption(latest), timeAgo(latest.finished_at)].filter(Boolean).join(' · ');
  const showComposer = canTalk && scoutRunStatus(root) !== 'running';
  const open = thread.picks.find((p) => p.id === openId) ?? null;

  const ask = async (text: string, pick: ShopperPick | null = about) => {
    try {
      await send(text, pick?.id ?? null);
      setAbout(null);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that.');
      return false;
    }
  };

  return (
    <ScreenBackground>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-4 p-4"
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: showComposer ? 16 : insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back"
              className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
            >
              <ArrowLeft size={20} className="text-muted-foreground" />
            </Pressable>
            <Text numberOfLines={1} className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">
              Scout · {scoutTitle(root.brief)}
            </Text>
            {canArchive && scoutRunStatus(root) !== 'running' && (
              <>
                <Pressable
                  onPress={() =>
                    void (root.archived_at
                      ? unarchiveScoutRun(updateScoutRun, root.id, archiveToast, refresh)
                      : archiveScoutRun(updateScoutRun, root.id, archiveToast).then((done) => done && router.back()))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={root.archived_at ? 'Move back to Shopper' : 'Archive search'}
                  className="h-11 w-11 items-center justify-center rounded-lg"
                >
                  {root.archived_at ? <ArchiveRestore size={18} className="text-muted-foreground" /> : <Archive size={18} className="text-muted-foreground" />}
                </Pressable>
                <Pressable
                  onPress={() => void deleteScoutRun(updateScoutRun, root.id, archiveToast).then((done) => done && router.back())}
                  accessibilityRole="button"
                  accessibilityLabel="Delete search"
                  className="h-11 w-11 items-center justify-center rounded-lg"
                >
                  <Trash2 size={18} className="text-muted-foreground" />
                </Pressable>
              </>
            )}
          </View>

          {status === 'running' && latest.id === root.id ? (
            <View className="flex-row items-center gap-3">
              <ActivityIndicator />
              <View className="min-w-0 flex-1">
                <Text className="font-heading text-base font-semibold text-muted-foreground">Researching</Text>
                <Text className="text-xs text-muted-foreground">Checking your stores for the best fits. About a minute.</Text>
              </View>
            </View>
          ) : status === 'failed' ? (
            <HeroLede value={0} label="picks" caption={scoutFailure(latest) ?? undefined} />
          ) : (
            <HeroLede value={headline.count} label={headline.caption} caption={caption || undefined} />
          )}

          <Text className="text-sm text-muted-foreground">
            &ldquo;{latest.brief.text}&rdquo;
            {budget ? ` · ${budget}` : ''}
          </Text>

          {items.map((item) =>
            item.kind === 'run' ? (
              <RunBlock key={item.run.id} run={item.run} picks={item.picks} first={item.first} onOpen={openPick} />
            ) : (
              <MessageRow key={item.message.id} message={item.message} picks={thread.picks} />
            ),
          )}

          {pending && (
            <>
              <View className="items-end">
                <View className="max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5">
                  <Text className="text-body text-foreground">{pending.text}</Text>
                </View>
              </View>
              <Thinking />
            </>
          )}
        </ScrollView>

        {showComposer && (
          <View className="gap-2 px-4 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
            {about ? (
              <View className="flex-row items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2">
                <MessageCircle size={16} className="text-muted-foreground" />
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                  {scoutPickAskLabel(about)}
                </Text>
                <Pressable onPress={() => setAbout(null)} accessibilityRole="button" accessibilityLabel="Stop asking about this pick" hitSlop={8}>
                  <X size={16} className="text-muted-foreground" />
                </Pressable>
              </View>
            ) : (
              !pending &&
              suggestions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
                  {suggestions.map((s) => (
                    <Pressable key={s} onPress={() => void ask(s, null)} accessibilityRole="button" className="rounded-full bg-muted px-3 py-1.5">
                      <Text className="text-[13px] font-medium text-muted-foreground">{s}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )
            )}
            <Composer
              key={composerKey}
              autoFocus={composerKey > 0}
              placeholder={about ? 'Ask about this pick' : 'Ask or change the search'}
              maxLength={SCOUT_FOLLOW_UP_MAX}
              busy={!!pending}
              onSend={(text) => ask(text)}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {open && (
        <PickSheet
          pick={open}
          open={sheetOpen}
          onClose={closePick}
          onWatched={refresh}
          onAsk={
            showComposer
              ? (pick) => {
                  closePick();
                  setAbout(pick);
                  setComposerKey((n) => n + 1);
                }
              : undefined
          }
        />
      )}
    </ScreenBackground>
  );
}

/** A run in the thread: the first run's picks as they always were; a refined run under a "New picks" rule. */
function RunBlock({ run, picks, first, onOpen }: { run: ShopperSearch; picks: ShopperPick[]; first: boolean; onOpen: (pick: ShopperPick) => void }) {
  const status = scoutRunStatus(run);
  return (
    <View className="gap-2">
      {!first && (
        <View className="flex-row items-center gap-2 px-1 pt-1">
          <Text className="text-micro-label uppercase text-muted-foreground">New picks</Text>
          <View className="h-px flex-1 bg-border" />
          <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {status === 'running' ? 'Researching…' : status === 'failed' ? "Didn't finish" : scoutStoresCaption(run)}
          </Text>
        </View>
      )}
      {!first && status === 'failed' && <Text className="px-1 text-sm text-muted-foreground">{scoutFailure(run)}</Text>}
      {picks.length > 0 && (
        <ListGroup>
          {picks.map((pick) => (
            <ListItem key={pick.id} onPress={() => onOpen(pick)} accessibilityRole="button">
              <ListItemLeading>
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-muted">
                  <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {pick.rank}
                  </Text>
                </View>
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle numberOfLines={1}>{pick.title}</ListItemTitle>
                <ListItemMeta>
                  <Text numberOfLines={1} className="text-caption text-muted-foreground">
                    {pick.stretch && <Text className="text-caption font-medium text-warning">Stretch · </Text>}
                    {pickMeta(pick)}
                  </Text>
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing>
                <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatMoney(pick.price_cents, { currency: pick.currency })}
                </Text>
              </ListItemTrailing>
            </ListItem>
          ))}
        </ListGroup>
      )}
    </View>
  );
}

function MessageRow({ message, picks }: { message: ScoutMessage; picks: ShopperPick[] }) {
  if (message.role === 'scout') {
    return (
      <View className="w-full px-1">
        <ReplyText text={message.text} />
      </View>
    );
  }
  const pick = message.pick_id ? picks.find((p) => p.id === message.pick_id) : undefined;
  return (
    <View className="items-end gap-1">
      {pick && <Text className="px-1 text-[11px] font-medium text-muted-foreground">{scoutPickAskLabel(pick)}</Text>}
      <View className="max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5">
        <Text className="text-body text-foreground">{message.text}</Text>
      </View>
    </View>
  );
}

function pickMeta(pick: ShopperPick): string {
  return [pick.label, pick.store, pick.in_stock === true ? 'in stock' : pick.in_stock === false ? 'out of stock' : null].filter(Boolean).join(' · ');
}

function PickSheet({
  pick,
  open,
  onClose,
  onWatched,
  onAsk,
}: {
  pick: ShopperPick;
  open: boolean;
  onClose: () => void;
  onWatched: () => void;
  onAsk?: (pick: ShopperPick) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const watch = async () => {
    setBusy(true);
    try {
      const want = await watchScoutPick(pick.id);
      onWatched();
      toast.success('Added to your watchlist.', { action: { label: 'Open', onPress: () => router.push(`/shopper/${want.id}` as Href) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not watch it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} className="pb-4">
      <View className="gap-4 px-4">
        <View className="gap-1">
          <Text className="text-micro-label uppercase text-muted-foreground">{pick.stretch ? 'Stretch' : pick.label || `Pick ${pick.rank}`}</Text>
          <Text className="font-heading text-lg font-semibold text-foreground">{pick.title}</Text>
          <Text className="text-2xl font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {formatMoney(pick.price_cents, { currency: pick.currency })}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {pick.store}
            {pick.in_stock === true ? ' · in stock' : pick.in_stock === false ? ' · out of stock' : ''}
          </Text>
        </View>
        {!!pick.why && <Text className="text-sm leading-relaxed text-foreground">{pick.why}</Text>}
        {pick.sources.length > 0 && (
          <View className="gap-1">
            <Text className="text-xs text-muted-foreground">Sources</Text>
            {pick.sources.map((s) => (
              <Pressable key={s.url} onPress={() => void Linking.openURL(s.url)} accessibilityRole="link" className="flex-row items-center gap-1 py-1">
                <Text className="text-sm text-primary">{s.title}</Text>
                <ExternalLink size={14} className="text-primary" />
              </Pressable>
            ))}
          </View>
        )}
        {onAsk && (
          <Pressable onPress={() => onAsk(pick)} accessibilityRole="button" className="flex-row items-center gap-1.5 self-start py-1">
            <MessageCircle size={16} className="text-primary" />
            <Text className="text-sm font-medium text-primary">Ask Scout about this</Text>
          </Pressable>
        )}
        <View className="flex-row gap-2">
          {pick.url && (
            <Button variant="secondary" className="h-12 flex-1 rounded-2xl" onPress={() => void Linking.openURL(pick.url!)}>
              <Text className="text-sm font-semibold text-foreground">Open at store</Text>
            </Button>
          )}
          {pick.want_id ? (
            <Button
              variant="secondary"
              className="h-12 flex-1 rounded-2xl"
              onPress={() => {
                onClose();
                router.push(`/shopper/${pick.want_id}` as Href);
              }}
            >
              <Text className="text-sm font-semibold text-foreground">Open in watchlist</Text>
            </Button>
          ) : (
            <Button className="h-12 flex-1 rounded-2xl" onPress={() => void watch()} disabled={busy}>
              <Text className="text-sm font-semibold text-primary-foreground">{busy ? 'Adding…' : 'Watch the price'}</Text>
            </Button>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}
