// Rewards: add or edit a card (Hearth E1-E4). The first field picks the
// scheme: one the household already has, one from the starter list (which
// brings its stores), or a new name. Then the number and code type as in
// Groceries' rewards sheet, who can see it, and when it expires. The web
// form's date input is DateScrollField here, since this sheet is itself a
// BottomSheet and can't nest another.
// Web twin: apps/web/src/app/rewards/card-form-sheet.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { WalletCards } from 'lucide-react-native';
import { Button, DateScrollField, FieldRow, FormSection, Input, ItemFormSheet, SegmentedControl } from '@homeup/ui';
import {
  LOYALTY_CARD_FORMATS,
  brandKey,
  formatLoyaltyNumber,
  loyaltyNumberError,
  normalizeLoyaltyNumber,
  rewardCatalogFor,
  searchRewardCatalog,
  useHouseholdCurrency,
  type LoyaltyCard,
  type LoyaltyCardFormat,
  type RewardCatalogEntry,
  type RewardsApi,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { Chip } from './chip';

const REWARDS_SECTION = { id: 'rewards', Icon: WalletCards };

type Visibility = 'shared' | 'private';
const VISIBILITY = [
  { value: 'shared' as const, label: 'Everyone' },
  { value: 'private' as const, label: 'Just me' },
];

export function CardFormSheet({
  open,
  onOpenChange,
  card,
  rewards,
  groupId,
  currentUserId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this one; omit to add. */
  card?: LoyaltyCard;
  rewards: RewardsApi;
  groupId: string;
  currentUserId: string | null;
  onSaved: (card: LoyaltyCard) => void;
}) {
  const currency = useHouseholdCurrency();
  const current = card ? rewards.schemeOf(card) : null;
  const [schemeName, setSchemeName] = React.useState(current?.name ?? card?.name ?? '');
  const [catalog, setCatalog] = React.useState<RewardCatalogEntry | null>(null);
  const [number, setNumber] = React.useState(card ? formatLoyaltyNumber(card.number) : '');
  const [format, setFormat] = React.useState<LoyaltyCardFormat>(card?.format ?? 'code128');
  const [visibility, setVisibility] = React.useState<Visibility>(card?.private ? 'private' : 'shared');
  const [expires, setExpires] = React.useState(card?.expires_on ?? '');
  const [notes, setNotes] = React.useState(card?.notes ?? '');
  const [tried, setTried] = React.useState(false);

  // Only the person who added a card can make it theirs alone; anyone else
  // would hide it from themselves.
  const canMakePrivate = !card || card.created_by === currentUserId;
  const normalized = normalizeLoyaltyNumber(number, format);
  const numberError = loyaltyNumberError(normalized, format);

  const suggestions = React.useMemo(() => {
    const key = brandKey(schemeName);
    const own = rewards.schemes.filter((s) => !key || brandKey(s.name).startsWith(key));
    const ownKeys = new Set(rewards.schemes.map((s) => brandKey(s.name)));
    const starters = searchRewardCatalog(rewardCatalogFor(currency), schemeName).filter((e) => !ownKeys.has(brandKey(e.name)));
    const exact = own.some((s) => brandKey(s.name) === key) || starters.some((e) => brandKey(e.name) === key);
    if (exact && !catalog) return { own: [], starters: [] };
    return { own: own.slice(0, 4), starters: catalog ? [] : starters.slice(0, 4) };
  }, [schemeName, rewards.schemes, currency, catalog]);

  const submit = () => {
    setTried(true);
    if (!schemeName.trim() || numberError) return;
    const key = brandKey(schemeName);
    const existing = rewards.schemes.find((s) => brandKey(s.name) === key);
    const starter = catalog ?? rewardCatalogFor(currency).find((e) => brandKey(e.name) === key);
    const schemeId = existing?.id ?? rewards.addScheme(starter ? { name: starter.name, catalog: starter } : { name: schemeName });
    const name = existing?.name ?? starter?.name ?? schemeName.trim();
    const fields = {
      name,
      number: normalized,
      format,
      scheme_id: schemeId,
      private: canMakePrivate && visibility === 'private',
      expires_on: expires || null,
      notes: notes.trim() || null,
    };
    const saved: LoyaltyCard = card
      ? { ...card, ...fields }
      : { id: randomUUID(), group_id: groupId, created_by: null, ...fields, deleted: false, created_at: '', updated_at: '' };
    rewards.saveCard(saved);
    onSaved(saved);
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={REWARDS_SECTION}
      title={card ? 'Edit card' : 'Add a card'}
      onSubmit={submit}
      submitLabel={card ? 'Save' : 'Add card'}
      onDelete={
        card
          ? () => {
              rewards.deleteCard(card.id);
              onOpenChange(false);
            }
          : undefined
      }
      deleteLabel="Remove card"
      deleteConfirmTitle={card ? `Remove ${card.name}?` : undefined}
      deleteConfirmMessage={card?.private ? 'Only you could see it.' : 'It goes for everyone in your household.'}
    >
      <FormSection>
        <FieldRow
          label="Card"
          required
          error={tried && !schemeName.trim() ? 'Name the card' : null}
          hint={catalog ? `Comes with ${catalog.partners.length} ${catalog.partners.length === 1 ? 'store' : 'stores'}` : undefined}
        >
          <Input
            autoFocus={!card}
            value={schemeName}
            onChangeText={(text) => {
              setSchemeName(text);
              setCatalog(null);
            }}
            placeholder="Flybuys, auto club, gym"
            maxLength={80}
            autoComplete="off"
          />
          {(suggestions.own.length > 0 || suggestions.starters.length > 0) && (
            <View className="flex-row flex-wrap gap-1.5 pt-1">
              {suggestions.own.map((s) => (
                <Chip key={s.id} label={s.name} onPress={() => setSchemeName(s.name)} />
              ))}
              {suggestions.starters.map((e) => (
                <Chip
                  key={e.id}
                  label={`${e.name} · ${e.partners.length}`}
                  onPress={() => {
                    setSchemeName(e.name);
                    setCatalog(e);
                  }}
                />
              ))}
            </View>
          )}
        </FieldRow>
        <FieldRow label="Card number" required error={tried ? numberError : null}>
          <Input
            value={number}
            onChangeText={setNumber}
            placeholder="6008 1234 5678 9012"
            className="font-mono"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FieldRow>
        <FieldRow label="Code" hint="Barcode suits most cards. Pick QR if the card shows a square code, or EAN-13 only if it says so.">
          <SegmentedControl options={LOYALTY_CARD_FORMATS} value={format} onChange={setFormat} accessibilityLabel="Code type" />
        </FieldRow>
        <FieldRow label="Who can see it" hint={canMakePrivate ? undefined : 'Only the person who added it can make it theirs alone.'}>
          <SegmentedControl
            options={canMakePrivate ? VISIBILITY : VISIBILITY.filter((v) => v.value === 'shared')}
            value={visibility}
            onChange={setVisibility}
            accessibilityLabel="Who can see it"
          />
        </FieldRow>
        <FieldRow
          label="Expires"
          action={expires !== '' && <Button size="xs" variant="ghost" onPress={() => setExpires('')}>Clear</Button>}
        >
          <DateScrollField value={expires} onChange={setExpires} emptyLabel="No expiry" maxYear={new Date().getFullYear() + 10} />
        </FieldRow>
        <FieldRow label="Notes" hint="Not for PINs or passwords.">
          <Input value={notes} onChangeText={setNotes} placeholder="Optional" maxLength={200} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
