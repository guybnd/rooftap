'use client';

// Rewards: the household's loyalty cards and memberships, built around one
// moment: standing in a shop, which card works here? The Cards tab opens on
// that question (a store search) over the wallet; typing a store swaps the
// Hero to the answer, best perk first (H1). The Perks tab lists what the
// cards get you, ending soon first. Tapping a card opens it ready to scan.
// Native twin: apps/mobile/src/app/(tabs)/rewards/index.tsx.
import { useRef, useState } from 'react';
import { Plus, Search, WalletCards } from 'lucide-react';
import {
  REWARDS_TABS,
  cardFaceColor,
  cardHolderLabel,
  cardTitle,
  currencySymbol,
  perkEndsCaption,
  perkListGroups,
  perkRowMeta,
  perkValueLabel,
  useHouseholdCurrency,
  useRewards,
  useRewardsScreen,
  walletCardDetail,
  dialog,
  type LoyaltyCard,
  type RowMenu,
  type RewardPerk,
  type RewardScheme,
  type StoreMatch,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
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
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';

const MICRO = 'px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

export default function RewardsPage() {
  const { group, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const currency = useHouseholdCurrency();
  const symbol = currencySymbol(currency);
  const rewards = useRewards(group?.id, currentUserId);
  const screen = useRewardsScreen(rewards, currentUserId);
  const { today, tab, setTab, query, setQuery, wallet, matches, livePerks, ending, quickStores, schemeById, partnerName, searching, topWithCard, lede } =
    screen;

  const wide = useWideLayout();
  const [shownId, setShownId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [schemeId, setSchemeId] = useState<string | null>(null);

  const { cards, schemes, partners, perks } = rewards;

  const shown = shownId ? cards.find((c) => c.id === shownId) : undefined;
  const editingCard = editing?.id ? cards.find((c) => c.id === editing.id) : undefined;
  const openScheme = schemeId ? schemeById.get(schemeId) : undefined;

  // Hearth §13.7 "Row menu": one menu for the wallet, filled by the face
  // that was right-clicked.
  const faceMenuRef = useRef<RowMenu | null>(null);
  const faceMenu = useRowContextMenu(() => faceMenuRef.current);

  if (cacheLoading || (!rewards.loaded && cards.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const holder = cardHolderLabel;

  const editStoresFor = (card: LoyaltyCard) => {
    const id = screen.storesSchemeFor(card);
    if (id) setSchemeId(id);
  };

  const showMatch = (m: StoreMatch) => {
    const target = screen.matchTarget(m);
    if (target.kind === 'card') setShownId(target.id);
    else setSchemeId(target.id);
  };

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
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
          <div className={cn(wide && 'max-w-xl')}>
            <SegmentedControl ariaLabel="Show" value={tab} onChange={setTab} options={REWARDS_TABS} />
          </div>

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
                // Hearth §13.7 "Desktop shell": card faces lay out like a wallet spread on a wide screen.
                <div className={cn('grid gap-2.5', wide && 'grid-cols-2 gap-4 xl:grid-cols-3')}>
                  {wallet.map((card) => {
                    const scheme = rewards.schemeOf(card);
                    const detail = walletCardDetail(card, scheme, partners, today);
                    return (
                      <CardFace
                        key={card.id}
                        color={cardFaceColor(scheme, card.name)}
                        title={cardTitle(card, scheme)}
                        holder={holder(card)}
                        detail={detail || undefined}
                        onClick={() => setShownId(card.id)}
                        onContextMenu={(e) => {
                          faceMenuRef.current = {
                            title: cardTitle(card, scheme),
                            kind: 'Card',
                            actions: [
                              { id: 'show', label: 'Show card', group: 'open', icon: 'open', run: () => setShownId(card.id) },
                              { id: 'copy', label: 'Copy number', group: 'share', icon: 'copy', run: () => void navigator.clipboard?.writeText(card.number) },
                              { id: 'edit', label: 'Edit card', group: 'edit', icon: 'edit', run: () => setEditing({ id: card.id }) },
                              { id: 'stores', label: 'Edit stores and perks', group: 'edit', icon: 'edit', run: () => editStoresFor(card) },
                              {
                                id: 'delete',
                                label: 'Delete',
                                group: 'danger',
                                icon: 'delete',
                                danger: true,
                                run: async () => {
                                  if (await dialog.confirm({ title: 'Delete this card?', destructive: true })) rewards.deleteCard(card.id);
                                },
                              },
                            ],
                          };
                          faceMenu.onContextMenu(e);
                        }}
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

      {faceMenu.menu}

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
  const wide = useWideLayout();
  if (perks.length === 0) {
    return (
      <div className="space-y-1 px-1 py-8 text-center">
        <Search className="mx-auto size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No perks yet. Open a card and add what it gets you.</p>
      </div>
    );
  }
  const groups = perkListGroups(perks, ending, schemes);
  const schemeName = new Map(schemes.map((s) => [s.id, s.name]));

  const row = (perk: RewardPerk, showScheme: boolean) => {
    const endsCaption = perkEndsCaption(perk.valid_until, today);
    const meta = perkRowMeta(perk, { showScheme, schemeName, partnerName });
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
    <div className={wide ? 'grid grid-cols-2 items-start gap-5 xl:grid-cols-3' : 'space-y-4'}>
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
