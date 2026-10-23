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
  useCardForm,
  type LoyaltyCard,
  type RewardsApi,
} from '@homeup/core';
import { Chip } from './chip';

const REWARDS_SECTION = { id: 'rewards', Icon: WalletCards };

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
  const form = useCardForm({ card, rewards, groupId, currentUserId, onSaved });
  const { schemeName, catalog, number, format, visibility, expires, notes, tried, canMakePrivate, numberError, suggestions } = form;

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={REWARDS_SECTION}
      title={card ? 'Edit card' : 'Add a card'}
      onSubmit={form.submit}
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
          error={form.nameError}
          hint={catalog ? `Comes with ${catalog.partners.length} ${catalog.partners.length === 1 ? 'store' : 'stores'}` : undefined}
        >
          <Input
            autoFocus={!card}
            value={schemeName}
            onChangeText={(text) => {
              form.typeSchemeName(text);
            }}
            placeholder="Flybuys, auto club, gym"
            maxLength={80}
            autoComplete="off"
          />
          {(suggestions.own.length > 0 || suggestions.starters.length > 0) && (
            <View className="flex-row flex-wrap gap-1.5 pt-1">
              {suggestions.own.map((s) => (
                <Chip key={s.id} label={s.name} onPress={() => form.setSchemeName(s.name)} />
              ))}
              {suggestions.starters.map((e) => (
                <Chip
                  key={e.id}
                  label={`${e.name} · ${e.partners.length}`}
                  onPress={() => {
                    form.pickStarter(e);
                  }}
                />
              ))}
            </View>
          )}
        </FieldRow>
        <FieldRow label="Card number" required error={tried ? numberError : null}>
          <Input
            value={number}
            onChangeText={form.setNumber}
            placeholder="6008 1234 5678 9012"
            className="font-mono"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FieldRow>
        <FieldRow label="Code" hint="Barcode suits most cards. Pick QR if the card shows a square code, or EAN-13 only if it says so.">
          <SegmentedControl options={LOYALTY_CARD_FORMATS} value={format} onChange={form.setFormat} accessibilityLabel="Code type" />
        </FieldRow>
        <FieldRow label="Who can see it" hint={canMakePrivate ? undefined : 'Only the person who added it can make it theirs alone.'}>
          <SegmentedControl
            options={form.visibilityOptions}
            value={visibility}
            onChange={form.setVisibility}
            accessibilityLabel="Who can see it"
          />
        </FieldRow>
        <FieldRow
          label="Expires"
          action={expires !== '' && <Button size="xs" variant="ghost" onPress={() => form.setExpires('')}>Clear</Button>}
        >
          <DateScrollField value={expires} onChange={form.setExpires} emptyLabel="No expiry" maxYear={new Date().getFullYear() + 10} />
        </FieldRow>
        <FieldRow label="Notes" hint="Not for PINs or passwords.">
          <Input value={notes} onChangeText={form.setNotes} placeholder="Optional" maxLength={200} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
