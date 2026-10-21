'use client';

// Rewards: one card ready to scan (the wallet's tap-through). The code is
// drawn on the device from the stored number, the screen is held awake, and
// the scheme's perks sit underneath so the question "what do I get?" is
// answered on the same sheet. Native twin:
// apps/mobile/src/features/rewards/card-sheet.tsx.
import { useMemo } from 'react';
import { Store } from 'lucide-react';
import {
  cardExpiryCaption,
  cardFaceColor,
  cardTitle,
  comparePerks,
  currencySymbol,
  formatLoyaltyNumber,
  perkEndsCaption,
  perkIsLive,
  perkValueLabel,
  storeCount,
  todayISO,
  useHouseholdCurrency,
  type LoyaltyCard,
  type RewardPartner,
  type RewardPerk,
  type RewardScheme,
} from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { CardCode } from '@/components/card-code';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';
import { useWakeLock } from '@/lib/wake-lock';
import { MiniFace } from './card-face';

const SHEET_CLASS =
  'max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4';

export function CardSheet({
  open,
  onOpenChange,
  card,
  scheme,
  partners,
  perks,
  holder,
  onEditCard,
  onEditScheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: LoyaltyCard;
  scheme: RewardScheme | null;
  /** Every live partner and perk; the sheet picks this scheme's. */
  partners: RewardPartner[];
  perks: RewardPerk[];
  holder: string;
  onEditCard: () => void;
  onEditScheme: () => void;
}) {
  useWakeLock(open);
  const currency = useHouseholdCurrency();
  const today = todayISO();
  const schemePartners = useMemo(() => partners.filter((p) => scheme && p.scheme_id === scheme.id), [partners, scheme]);
  const schemePerks = useMemo(
    () => perks.filter((p) => scheme && p.scheme_id === scheme.id && perkIsLive(p, today)).sort(comparePerks),
    [perks, scheme, today],
  );
  const partnerName = new Map(schemePartners.map((p) => [p.id, p.name]));
  const stores = storeCount(schemePartners);
  const caption = [holder, cardExpiryCaption(card.expires_on, today)].filter(Boolean).join(' · ');

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="bg-black/40"
      className={SHEET_CLASS}
      handleClassName="sm:hidden"
      popupProps={{ 'aria-label': cardTitle(card, scheme) }}
    >
      <div className="space-y-4 pt-1">
        <div className="flex items-center gap-3">
          <MiniFace color={cardFaceColor(scheme, card.name)} />
          <div className="min-w-0">
            <p className="truncate font-heading text-base font-semibold text-foreground">{cardTitle(card, scheme)}</p>
            <p className="truncate text-xs text-muted-foreground">{caption}</p>
          </div>
        </div>
        <CardCode number={card.number} format={card.format} />
        <p className="select-all text-center font-mono text-lg tabular-nums text-foreground">
          {formatLoyaltyNumber(card.number)}
        </p>
        <p className="text-center text-xs text-muted-foreground">Turn your brightness up if it won&apos;t scan</p>
        {card.notes && <p className="text-sm text-muted-foreground">{card.notes}</p>}

        {scheme && (
          <div className="space-y-1.5">
            <p className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Perks</p>
            <ListGroup className="border-0 bg-muted/50 shadow-none">
              {schemePerks.slice(0, 6).map((perk) => {
                const where = perk.partner_id ? partnerName.get(perk.partner_id) : 'Every store';
                const meta = [where, perk.conditions, perkEndsCaption(perk.valid_until, today)].filter(Boolean).join(' · ');
                return (
                  <ListItem key={perk.id}>
                    <ListItemContent>
                      <ListItemTitle>{perk.title}</ListItemTitle>
                      {meta && (
                        <ListItemMeta>
                          <span className="truncate">{meta}</span>
                        </ListItemMeta>
                      )}
                    </ListItemContent>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                      {perkValueLabel(perk, currencySymbol(currency))}
                    </span>
                  </ListItem>
                );
              })}
              <ListItem asChild className="cursor-pointer hover:bg-muted">
                <button type="button" onClick={onEditScheme} className="text-left">
                  <Store className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                  <ListItemContent className="self-center">
                    <ListItemTitle>
                      {stores === 0 ? 'Add the stores it works at' : `${stores} ${stores === 1 ? 'store' : 'stores'}`}
                    </ListItemTitle>
                    <ListItemMeta>
                      <span>{schemePerks.length === 0 ? 'and what you get there' : 'Stores and perks'}</span>
                    </ListItemMeta>
                  </ListItemContent>
                </button>
              </ListItem>
            </ListGroup>
          </div>
        )}

        <div className="flex justify-between pt-1">
          <Button variant="ghost" className="h-11" onClick={onEditCard}>
            Edit card
          </Button>
          {!scheme && (
            <Button variant="ghost" className="h-11" onClick={onEditScheme}>
              Add stores
            </Button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
