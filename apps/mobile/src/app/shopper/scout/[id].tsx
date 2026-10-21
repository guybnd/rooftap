// HOUP-435: one Scout run. While it researches, the head says so; once done
// the Hero counts the picks ("3 picks under $2,000", H1) with the stores
// checked and when, and each pick is a §6 row: rank, title, its role, store
// and stock, today's price trailing. A pick opens its sheet: why it fits,
// every source behind it, and the actions. Web twin:
// apps/web/src/app/shopper/scout/[id]/page.tsx.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ArrowLeft, ExternalLink } from 'lucide-react-native';
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
  formatMoney,
  scoutBudgetLabel,
  scoutFailure,
  scoutHeadline,
  scoutRunStatus,
  scoutStoresCaption,
  scoutTitle,
  timeAgo,
  MOTION_DURATIONS_MS,
  type ShopperPick,
  type ShopperSearch,
} from '@homeup/core';
import { scoutRun, watchScoutPick } from '@/features/shopper/shopper-api';

const POLL_MS = 3000;

export default function ScoutRunScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [search, setSearch] = React.useState<ShopperSearch | null | undefined>(undefined);
  const [picks, setPicks] = React.useState<ShopperPick[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  const status = search ? scoutRunStatus(search) : null;

  React.useEffect(() => {
    let cancelled = false;
    scoutRun(id)
      .then((run) => {
        if (cancelled) return;
        setSearch(run.search);
        setPicks(run.picks);
      })
      .catch(() => !cancelled && setSearch((prev) => prev ?? null));
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  // Poll while it researches; the run lands in a minute or so.
  React.useEffect(() => {
    if (status !== 'running') return;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [status, tick]);

  const openPick = (pick: ShopperPick) => {
    setOpenId(pick.id);
    setSheetOpen(true);
  };
  const closePick = () => {
    setSheetOpen(false);
    setTimeout(() => setOpenId(null), MOTION_DURATIONS_MS.exit);
  };

  if (search === undefined) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (search === null) {
    return (
      <ScreenBackground className="items-center justify-center gap-3 p-6">
        <Text className="text-muted-foreground">Scout run not found.</Text>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <Text className="text-sm font-medium text-foreground">Back to Shopper</Text>
        </Button>
      </ScreenBackground>
    );
  }

  const budget = scoutBudgetLabel(search.brief);
  const headline = scoutHeadline(picks, search.brief);
  const caption = [scoutStoresCaption(search), timeAgo(search.finished_at)].filter(Boolean).join(' · ');
  const open = picks.find((p) => p.id === openId) ?? null;

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
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
            Scout · {scoutTitle(search.brief)}
          </Text>
        </View>

        {status === 'running' ? (
          <View className="flex-row items-center gap-3">
            <ActivityIndicator />
            <View className="min-w-0 flex-1">
              <Text className="font-heading text-base font-semibold text-muted-foreground">Researching</Text>
              <Text className="text-xs text-muted-foreground">Checking your stores for the best fits. About a minute.</Text>
            </View>
          </View>
        ) : status === 'failed' ? (
          <HeroLede value={0} label="picks" caption={scoutFailure(search) ?? undefined} />
        ) : (
          <HeroLede value={headline.count} label={headline.caption} caption={caption || undefined} />
        )}

        <Text className="text-sm text-muted-foreground">
          &ldquo;{search.brief.text}&rdquo;
          {budget ? ` · ${budget}` : ''}
        </Text>

        {picks.length > 0 && (
          <ListGroup>
            {picks.map((pick) => (
              <ListItem key={pick.id} onPress={() => openPick(pick)} accessibilityRole="button">
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
      </ScrollView>

      {open && <PickSheet pick={open} open={sheetOpen} onClose={closePick} onWatched={() => setTick((n) => n + 1)} />}
    </ScreenBackground>
  );
}

function pickMeta(pick: ShopperPick): string {
  return [pick.label, pick.store, pick.in_stock === true ? 'in stock' : pick.in_stock === false ? 'out of stock' : null].filter(Boolean).join(' · ');
}

function PickSheet({ pick, open, onClose, onWatched }: { pick: ShopperPick; open: boolean; onClose: () => void; onWatched: () => void }) {
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
