'use client';

// Rewards: the household's loyalty cards and memberships, built around one
// moment: standing in a shop, which card works here? The Cards tab opens on
// that question (a store search) over the wallet; typing a store swaps the
// Hero to the answer, best perk first (H1). The Perks tab lists what the
// cards get you, ending soon first. Tapping a card opens it ready to scan.
// Proposal: /mnt/project-files/design/rewards/proposal.html.
// Native twin: apps/mobile/src/app/(tabs)/rewards/index.tsx.
import { useMemo, useState } from 'react';
import { Plus, Search, WalletCards } from 'lucide-react';
import {
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
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { OfflineHint } from '@/components/offline-hint';
import { SectionSearchBar } from '@/components/section-search-bar';
import { CardFace, MiniFace } from './card-face';
import { CardSheet } from './card-sheet';
import { CardFormSheet } from './card-form-sheet';
import { SchemeSheet } from './scheme-sheet';

type Tab = 'cards' | 'perks';
const TABS: { value: Tab; label: string }[] = [
  { value: 'cards', label: 'Cards' },
  { value: 'perks', label: 'Perks' },
];

const MICRO = 'px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

export default function RewardsPage() {
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const currency = useHouseholdCurrency();
  const symbol = currencySymbol(currency);
  const rewards = useRewards(group?.id, currentUserId);
  const today = todayISO();

  const [tab, setTab] = useState<Tab>('cards');
  const [query, setQuery] = useState('');
  const [shownId, setShownId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [schemeId, setSchemeId] = useState<string | null>(null);

  const { cards, schemes, partners, perks } = rewards;
  const wallet = useMemo(() => walletOrder(cards, schemes), [cards, schemes]);
  const matches = useMemo(() => cardsForStore(query, rewards, today), [query, rewards, today]);
  const livePerks = useMemo(() => perks.filter((p) => perkIsLive(p, today)), [perks, today]);
  const ending = useMemo(() => perksEndingSoon(livePerks, today), [livePerks, today]);
  const quickStores = useMemo(() => popularStores(partners), [partners]);
  const schemeById = useMemo(() => new Map(schemes.map((s) => [s.id, s])), [schemes]);
  const partnerName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);

  const shown = shownId ? cards.find((c) => c.id === shownId) : undefined;
  const editingCard = editing?.id ? cards.find((c) => c.id === editing.id) : undefined;
  const openScheme = schemeId ? schemeById.get(schemeId) : undefined;

  if (cacheLoading || (!rewards.loaded && cards.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const holder = (card: LoyaltyCard) => (card.private ? 'Just me' : 'Shared');
  const searching = tab === 'cards' && query.trim().length >= 2;

  // A card from before Rewards (Groceries' sheet) has no scheme yet: give it
  // one named after the card, so it can gain stores and perks.
  const editStoresFor = (card: LoyaltyCard) => {
    const existing = rewards.schemeOf(card);
    if (existing) {
      setSchemeId(existing.id);
      return;
    }
    const id = rewards.addScheme({ name: card.name });
    if (!id) return;
    rewards.saveCard({ ...card, scheme_id: id });
    setSchemeId(id);
  };

  const showMatch = (m: StoreMatch) => {
    const mine = m.cards.find((c) => c.created_by === currentUserId) ?? m.cards[0];
    if (mine) setShownId(mine.id);
    else setSchemeId(m.scheme.id);
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
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
      <HeroLede
        layout="inline"
        value={lede.value}
        label={lede.label}
        caption={lede.caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            <button
              type="button"
              onClick={() => setEditing({ id: null })}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </>
        }
      />

      {cards.length === 0 && schemes.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="No cards yet"
          description="Add your loyalty cards and memberships, and the stores they work at. Then look up any store to see which card to use."
          action={{ label: 'Add a card', onClick: () => setEditing({ id: null }), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <div className="space-y-3">
          <SegmentedControl ariaLabel="Show" value={tab} onChange={setTab} options={TABS} />

          {tab === 'cards' && (
            <>
              <SectionSearchBar value={query} onChange={setQuery} placeholder="Which store are you at?" />

              {!query && quickStores.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {quickStores.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setQuery(name)}
                      className="min-h-9 rounded-full bg-muted px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {searching ? (
                matches.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                    None of your cards list {query.trim()}. Open a card and add it to its stores.
                  </p>
                ) : (
                  <>
                    <ListGroup>
                      {matches.map((m) => (
                        <MatchRow key={m.scheme.id} match={m} symbol={symbol} onClick={() => showMatch(m)} />
                      ))}
                    </ListGroup>
                    {topWithCard && (
                      <Button className="h-12 w-full text-[15px]" onClick={() => showMatch(topWithCard)}>
                        <WalletCards className="size-[18px]" />
                        Show {topWithCard.scheme.name} card
                      </Button>
                    )}
                  </>
                )
              ) : query.trim().length === 1 ? null : (
                <div className="grid gap-2.5">
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
                        onClick={() => setShownId(card.id)}
                      />
                    );
                  })}
                  {wallet.length === 0 && (
                    <p className="px-1 py-6 text-center text-sm text-muted-foreground">No cards yet. Add one to show it at the till.</p>
                  )}
                </div>
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
              onOpen={(perk) => setSchemeId(perk.scheme_id)}
            />
          )}
        </div>
      )}

      {shown && (
        <CardSheet
          open
          onOpenChange={(open) => !open && setShownId(null)}
          card={shown}
          scheme={rewards.schemeOf(shown)}
          partners={partners}
          perks={perks}
          holder={holder(shown)}
          onEditCard={() => {
            setShownId(null);
            setEditing({ id: shown.id });
          }}
          onEditScheme={() => {
            setShownId(null);
            editStoresFor(shown);
          }}
        />
      )}

      {editing && (
        <CardFormSheet
          key={editing.id ?? 'new'}
          isOpen
          onClose={() => setEditing(null)}
          card={editingCard}
          rewards={rewards}
          groupId={group.id}
          currentUserId={currentUserId}
          onSaved={(card) => {
            setEditing(null);
            setShownId(card.id);
          }}
        />
      )}

      {openScheme && (
        <SchemeSheet key={openScheme.id} isOpen onClose={() => setSchemeId(null)} scheme={openScheme} rewards={rewards} groupId={group.id} />
      )}
    </div>
  );
}

function MatchRow({ match, symbol, onClick }: { match: StoreMatch; symbol: string; onClick: () => void }) {
  const { scheme, best, cards } = match;
  const meta = [best?.conditions ?? (best ? null : 'No perks saved'), cards.length === 0 ? 'no card added' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem asChild className="cursor-pointer hover:bg-muted/50">
      <button type="button" onClick={onClick} className="text-left">
        <MiniFace color={cardFaceColor(scheme)} />
        <ListItemContent>
          <ListItemTitle>
            <span className="truncate">{scheme.name}</span>
          </ListItemTitle>
          {meta && (
            <ListItemMeta>
              <span className="truncate">{best && !best.conditions ? best.title : meta}</span>
            </ListItemMeta>
          )}
        </ListItemContent>
        {best && <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{perkValueLabel(best, symbol) ?? best.title}</span>}
      </button>
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
    return (
      <div className="space-y-1 px-1 py-8 text-center">
        <Search className="mx-auto size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No perks yet. Open a card and add what it gets you.</p>
      </div>
    );
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
      <ListItem key={perk.id} asChild className="cursor-pointer hover:bg-muted/50">
        <button type="button" onClick={() => onOpen(perk)} className="text-left">
          <ListItemContent>
            <ListItemTitle>
              <span className="truncate">{perk.title}</span>
            </ListItemTitle>
            <ListItemMeta>
              <span className="truncate">{meta}</span>
              {endsCaption && <span className="shrink-0 text-warning">{endsCaption}</span>}
            </ListItemMeta>
          </ListItemContent>
          <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{perkValueLabel(perk, symbol)}</span>
        </button>
      </ListItem>
    );
  };

  return (
    <div className="space-y-4">
      {ending.length > 0 && (
        <div className="space-y-1.5">
          <p className={MICRO}>Ending soon</p>
          <ListGroup>{ending.map((p) => row(p, true))}</ListGroup>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.scheme.id} className="space-y-1.5">
          <p className={MICRO}>{g.scheme.name}</p>
          <ListGroup>{g.perks.map((p) => row(p, false))}</ListGroup>
        </div>
      ))}
    </div>
  );
}
