// Rewards: one card ready to scan (the wallet's tap-through). The code is
// drawn on the device from the stored number, the screen is held awake, and
// the scheme's perks sit underneath so "what do I get?" is answered on the
// same sheet. Web twin: apps/web/src/app/rewards/card-sheet.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { Store } from 'lucide-react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Button,
  CardCode,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  Text,
} from '@homeup/ui';
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
import { useKeepAwakeWhile } from '@/lib/keep-awake';
import { MiniFace } from './card-face';

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
  useKeepAwakeWhile(open, 'rewards-card');
  const currency = useHouseholdCurrency();
  const today = todayISO();
  const schemePartners = React.useMemo(() => partners.filter((p) => scheme && p.scheme_id === scheme.id), [partners, scheme]);
  const schemePerks = React.useMemo(
    () => perks.filter((p) => scheme && p.scheme_id === scheme.id && perkIsLive(p, today)).sort(comparePerks),
    [perks, scheme, today],
  );
  const partnerName = new Map(schemePartners.map((p) => [p.id, p.name]));
  const stores = storeCount(schemePartners);
  const caption = [holder, cardExpiryCaption(card.expires_on, today)].filter(Boolean).join(' · ');

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[88%]">
      <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-4 pb-6 pt-1">
        <View className="flex-row items-center gap-3">
          <MiniFace color={cardFaceColor(scheme, card.name)} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-heading text-title text-foreground">
              {cardTitle(card, scheme)}
            </Text>
            <Text numberOfLines={1} className="text-caption text-muted-foreground">
              {caption}
            </Text>
          </View>
        </View>
        <CardCode number={card.number} format={card.format} />
        <Text selectable className="text-center font-mono text-lg tabular-nums text-foreground">
          {formatLoyaltyNumber(card.number)}
        </Text>
        <Text className="text-center text-caption text-muted-foreground">Turn your brightness up if it won&apos;t scan</Text>
        {!!card.notes && <Text className="text-sm text-muted-foreground">{card.notes}</Text>}

        {scheme && (
          <View className="gap-1.5">
            <Text className="px-1 text-micro-label uppercase text-muted-foreground">Perks</Text>
            <ListGroup bordered={false} className="rounded-2xl bg-muted/50">
              {schemePerks.slice(0, 6).map((perk) => {
                const where = perk.partner_id ? partnerName.get(perk.partner_id) : 'Every store';
                const meta = [where, perk.conditions, perkEndsCaption(perk.valid_until, today)].filter(Boolean).join(' · ');
                return (
                  <ListItem key={perk.id}>
                    <ListItemContent>
                      <ListItemTitle numberOfLines={1}>{perk.title}</ListItemTitle>
                      {!!meta && (
                        <ListItemMeta>
                          <Text numberOfLines={1} className="text-caption text-muted-foreground">
                            {meta}
                          </Text>
                        </ListItemMeta>
                      )}
                    </ListItemContent>
                    <Text className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                      {perkValueLabel(perk, currencySymbol(currency)) ?? ''}
                    </Text>
                  </ListItem>
                );
              })}
              <ListItem onPress={onEditScheme} accessibilityRole="button">
                <Store size={18} className="shrink-0 text-muted-foreground" />
                <ListItemContent className="self-center">
                  <ListItemTitle>
                    {stores === 0 ? 'Add the stores it works at' : `${stores} ${stores === 1 ? 'store' : 'stores'}`}
                  </ListItemTitle>
                  <ListItemMeta>
                    <Text className="text-caption text-muted-foreground">
                      {schemePerks.length === 0 ? 'and what you get there' : 'Stores and perks'}
                    </Text>
                  </ListItemMeta>
                </ListItemContent>
              </ListItem>
            </ListGroup>
          </View>
        )}

        <View className="flex-row justify-between pt-1">
          <Button variant="ghost" onPress={onEditCard}>
            Edit card
          </Button>
          {!scheme && (
            <Button variant="ghost" onPress={onEditScheme}>
              Add stores
            </Button>
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
