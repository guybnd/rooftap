// Rewards: the household's loyalty cards and memberships, built around one
// moment: standing in a shop, which card works here? The Cards tab opens on
// that question (a store search) over the wallet; typing a store swaps the
// Hero to the answer, best perk first (H1). The Perks tab lists what the
// cards get you, ending soon first. Tapping a card opens it ready to scan.
// Web twin: apps/web/src/app/rewards/page.tsx.
import * as React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, WalletCards, WifiOff } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ScreenBackground,
  SegmentedControl,
  SectionSearchBar,
  Text,
} from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  cardExpiryCaption,
  cardFaceColor,
  cardTitle,
  cardsForStore,
  comparePerks,
  currencySymbol,
  matchedStoreName,
  perkEndsCaption,
  perkIsLive,
  perkValueLabel,
  perksEndingSoon,
  popularStores,
  storeCount,
  todayISO,
  useHouseholdCurrency,
  useRewards,
  walletOrder,
  type LoyaltyCard,
  type RewardPerk,
  type RewardScheme,
  type StoreMatch,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { CardFace, MiniFace } from '@/features/rewards/card-face';
import { CardSheet } from '@/features/rewards/card-sheet';
import { CardFormSheet } from '@/features/rewards/card-form-sheet';
import { SchemeSheet } from '@/features/rewards/scheme-sheet';
import { Chip } from '@/features/rewards/chip';

type Tab = 'cards' | 'perks';
const TABS: { value: Tab; label: string }[] = [
  { value: 'cards', label: 'Cards' },
  { value: 'perks', label: 'Perks' },
];

/**
 * One sheet's mount and open state, kept apart so its exit animation can play
 * before it unmounts (HOUP-191). `show` opens it with a value.
 */
function useSheetState<T>() {
  const [value, setValue] = React.useState<T | null>(null);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback((next: T) => {
    if (timer.current) clearTimeout(timer.current);
    setValue(next);
    setOpen(true);
  }, []);
  const hide = React.useCallback(() => {
    setOpen(false);
    timer.current = setTimeout(() => setValue(null), MOTION_DURATIONS_MS.exit);
  }, []);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { value, open, show, hide };
}

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const currency = useHouseholdCurrency();
  const symbol = currencySymbol(currency);
  const rewards = useRewards(group?.id, currentUserId);
  const today = todayISO();

  const [tab, setTab] = React.useState<Tab>('cards');
  const [query, setQuery] = React.useState('');
  const cardSheet = useSheetState<string>();
  const formSheet = useSheetState<{ id: string | null }>();
  const schemeSheet = useSheetState<string>();

  const { cards, schemes, partners, perks } = rewards;
  const wallet = React.useMemo(() => walletOrder(cards, schemes), [cards, schemes]);
  const matches = React.useMemo(() => cardsForStore(query, rewards, today), [query, rewards, today]);
  const livePerks = React.useMemo(() => perks.filter((p) => perkIsLive(p, today)), [perks, today]);
  const ending = React.useMemo(() => perksEndingSoon(livePerks, today), [livePerks, today]);
  const quickStores = React.useMemo(() => popularStores(partners), [partners]);
  const schemeById = React.useMemo(() => new Map(schemes.map((s) => [s.id, s])), [schemes]);
  const partnerName = React.useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);

  if (cacheLoading || (!rewards.loaded && cards.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group) return <NoGroupScreen />;

  const shown = cardSheet.value ? cards.find((c) => c.id === cardSheet.value) : undefined;
  const editingCard = formSheet.value?.id ? cards.find((c) => c.id === formSheet.value?.id) : undefined;
  const openScheme = schemeSheet.value ? schemeById.get(schemeSheet.value) : undefined;
  const holder = (card: LoyaltyCard) => (card.private ? 'Just me' : 'Shared');
  const searching = tab === 'cards' && query.trim().length >= 2;

  // One sheet at a time: close the open one, then open the next once it has gone.
  const after = (fn: () => void) => setTimeout(fn, MOTION_DURATIONS_MS.exit);

  // A card from before Rewards (Groceries' sheet) has no scheme yet: give it
  // one named after the card, so it can gain stores and perks.
  const editStoresFor = (card: LoyaltyCard) => {
    const existing = rewards.schemeOf(card);
    if (existing) {
      schemeSheet.show(existing.id);
      return;
    }
    const id = rewards.addScheme({ name: card.name });
    if (!id) return;
    rewards.saveCard({ ...card, scheme_id: id });
    schemeSheet.show(id);
  };

  const showMatch = (m: StoreMatch) => {
    const mine = m.cards.find((c) => c.created_by === currentUserId) ?? m.cards[0];
    if (mine) cardSheet.show(mine.id);
    else schemeSheet.show(m.scheme.id);
  };
  const topWithCard = matches.find((m) => m.cards.length > 0);

  const lede = (() => {
    if (tab === 'perks') {
      return {
        value: livePerks.length,
        label: livePerks.length === 1 ? 'perk' : 'perks',
        caption: ending.length ? `${ending.length} ending this month` : `across ${schemes.length} ${schemes.length === 1 ? 'scheme' : 'schemes'}`,
      };
    }
    if (searching) {
      const store = matchedStoreName(query, matches);
      return {
        value: matches.length,
        label: `${matches.length === 1 ? 'works' : 'work'} at ${store}`,
        caption: matches.length ? `${matches.filter((m) => m.cards.length).length} with a card` : 'Nothing listed there yet',
      };
    }
    const stores = storeCount(partners);
    return {
      value: cards.length,
      label: cards.length === 1 ? 'card' : 'cards',
      caption: stores ? `works at ${stores} ${stores === 1 ? 'store' : 'stores'}` : 'Add the stores each card works at',
    };
  })();

  return (
    <ScreenBackground>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32, gap: 16 }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
            Rewards
          </Text>
          <View className="shrink-0 flex-row items-center gap-1.5">
            {!isOnline && (
              <View className="flex-row items-center gap-1 pr-0.5">
                <WifiOff size={12} className="shrink-0 text-muted-foreground" />
                <Text className="text-xs text-muted-foreground">Offline</Text>
              </View>
            )}
            <Button size="sm" onPress={() => formSheet.show({ id: null })}>
              <Plus size={14} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">Add</Text>
            </Button>
          </View>
        </View>
        <HeroLede value={lede.value} label={lede.label} caption={lede.caption} />

        {cards.length === 0 && schemes.length === 0 ? (
          <EmptyState
            icon={WalletCards}
            title="No cards yet"
            description="Add your loyalty cards and memberships, and the stores they work at. Then look up any store to see which card to use."
            action={{ label: 'Add a card', onPress: () => formSheet.show({ id: null }), icon: <Plus size={14} className="text-primary-foreground" /> }}
          />
        ) : (
          <>
            <SegmentedControl accessibilityLabel="Show" value={tab} onChange={setTab} options={TABS} />

            {tab === 'cards' && (
              <>
                <SectionSearchBar value={query} onChange={setQuery} placeholder="Which store are you at?" />
                {!query && quickStores.length > 0 && (
                  <View className="flex-row flex-wrap gap-1.5">
                    {quickStores.map((name) => (
                      <Chip key={name} label={name} onPress={() => setQuery(name)} />
                    ))}
                  </View>
                )}

                {searching ? (
                  matches.length === 0 ? (
                    <Text className="px-1 py-6 text-center text-sm text-muted-foreground">
                      None of your cards list {query.trim()}. Open a card and add it to its stores.
                    </Text>
                  ) : (
                    <>
                      <ListGroup>
                        {matches.map((m) => (
                          <MatchRow key={m.scheme.id} match={m} symbol={symbol} onPress={() => showMatch(m)} />
                        ))}
                      </ListGroup>
                      {topWithCard && (
                        <Button className="h-12" onPress={() => showMatch(topWithCard)}>
                          <WalletCards size={18} className="text-primary-foreground" />
                          <Text className="text-[15px] font-semibold text-primary-foreground">Show {topWithCard.scheme.name} card</Text>
                        </Button>
                      )}
                    </>
                  )
                ) : query.trim().length === 1 ? null : (
                  <View className="gap-2.5">
                    {wallet.map((card) => {
                      const scheme = rewards.schemeOf(card);
                      const stores = scheme ? storeCount(partners, new Set([scheme.id])) : 0;
                      const detail = [stores ? `${stores} ${stores === 1 ? 'store' : 'stores'}` : null, cardExpiryCaption(card.expires_on, today)]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <CardFace
                          key={card.id}
                          color={cardFaceColor(scheme, card.name)}
                          title={cardTitle(card, scheme)}
                          holder={holder(card)}
                          detail={detail || undefined}
                          onPress={() => cardSheet.show(card.id)}
                        />
                      );
                    })}
                    {wallet.length === 0 && (
                      <Text className="px-1 py-6 text-center text-sm text-muted-foreground">No cards yet. Add one to show it at the till.</Text>
                    )}
                  </View>
                )}
              </>
            )}

            {tab === 'perks' && (
              <PerksList
                perks={livePerks}
                ending={ending}
                schemes={schemes}
                partnerName={partnerName}
                symbol={symbol}
                today={today}
                onOpen={(perk) => schemeSheet.show(perk.scheme_id)}
              />
            )}
          </>
        )}
      </ScrollView>

      {shown && (
        <CardSheet
          open={cardSheet.open}
          onOpenChange={(next) => !next && cardSheet.hide()}
          card={shown}
          scheme={rewards.schemeOf(shown)}
          partners={partners}
          perks={perks}
          holder={holder(shown)}
          onEditCard={() => {
            cardSheet.hide();
            after(() => formSheet.show({ id: shown.id }));
          }}
          onEditScheme={() => {
            cardSheet.hide();
            after(() => editStoresFor(shown));
          }}
        />
      )}

      {formSheet.value && (
        <CardFormSheet
          key={formSheet.value.id ?? 'new'}
          open={formSheet.open}
          onOpenChange={(next) => !next && formSheet.hide()}
          card={editingCard}
          rewards={rewards}
          groupId={group.id}
          currentUserId={currentUserId}
          onSaved={(card) => {
            formSheet.hide();
            after(() => cardSheet.show(card.id));
          }}
        />
      )}

      {openScheme && (
        <SchemeSheet
          key={openScheme.id}
          open={schemeSheet.open}
          onOpenChange={(next) => !next && schemeSheet.hide()}
          scheme={openScheme}
          rewards={rewards}
          groupId={group.id}
        />
      )}
    </ScreenBackground>
  );
}

function MatchRow({ match, symbol, onPress }: { match: StoreMatch; symbol: string; onPress: () => void }) {
  const { scheme, best, cards } = match;
  const meta = best
    ? best.conditions ?? best.title
    : ['No perks saved', cards.length === 0 ? 'no card added' : null].filter(Boolean).join(' · ');
  return (
    <ListItem onPress={onPress} accessibilityRole="button">
      <MiniFace color={cardFaceColor(scheme)} />
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{scheme.name}</ListItemTitle>
        <ListItemMeta>
          <Text numberOfLines={1} className="text-caption text-muted-foreground">
            {cards.length === 0 && best ? `${meta} · no card added` : meta}
          </Text>
        </ListItemMeta>
      </ListItemContent>
      {best && <Text className="shrink-0 text-sm font-medium tabular-nums text-foreground">{perkValueLabel(best, symbol) ?? best.title}</Text>}
    </ListItem>
  );
}

function PerksList({
  perks,
  ending,
  schemes,
  partnerName,
  symbol,
  today,
  onOpen,
}: {
  perks: RewardPerk[];
  ending: RewardPerk[];
  schemes: RewardScheme[];
  partnerName: Map<string, string>;
  symbol: string;
  today: string;
  onOpen: (perk: RewardPerk) => void;
}) {
  if (perks.length === 0) {
    return <Text className="px-1 py-8 text-center text-sm text-muted-foreground">No perks yet. Open a card and add what it gets you.</Text>;
  }
  const endingIds = new Set(ending.map((p) => p.id));
  const groups = schemes
    .map((s) => ({ scheme: s, perks: perks.filter((p) => p.scheme_id === s.id && !endingIds.has(p.id)).sort(comparePerks) }))
    .filter((g) => g.perks.length > 0)
    .sort((a, b) => a.scheme.name.localeCompare(b.scheme.name));
  const schemeName = new Map(schemes.map((s) => [s.id, s.name]));

  const row = (perk: RewardPerk, showScheme: boolean) => {
    const where = perk.partner_id ? partnerName.get(perk.partner_id) : 'Every store';
    const endsCaption = perkEndsCaption(perk.valid_until, today);
    const meta = [showScheme ? schemeName.get(perk.scheme_id) : null, where, perk.conditions].filter(Boolean).join(' · ');
    return (
      <ListItem key={perk.id} onPress={() => onOpen(perk)} accessibilityRole="button">
        <ListItemContent>
          <ListItemTitle numberOfLines={1}>{perk.title}</ListItemTitle>
          <ListItemMeta>
            <Text numberOfLines={1} className="shrink text-caption text-muted-foreground">
              {meta}
            </Text>
            {!!endsCaption && <Text className="shrink-0 text-caption text-warning">{endsCaption}</Text>}
          </ListItemMeta>
        </ListItemContent>
        <Text className="shrink-0 text-sm font-medium tabular-nums text-foreground">{perkValueLabel(perk, symbol) ?? ''}</Text>
      </ListItem>
    );
  };

  return (
    <View className="gap-4">
      {ending.length > 0 && (
        <View className="gap-1.5">
          <Text className="px-1 text-micro-label uppercase text-muted-foreground">Ending soon</Text>
          <ListGroup>{ending.map((p) => row(p, true))}</ListGroup>
        </View>
      )}
      {groups.map((g) => (
        <View key={g.scheme.id} className="gap-1.5">
          <Text className="px-1 text-micro-label uppercase text-muted-foreground">{g.scheme.name}</Text>
          <ListGroup>{g.perks.map((p) => row(p, false))}</ListGroup>
        </View>
      ))}
    </View>
  );
}
