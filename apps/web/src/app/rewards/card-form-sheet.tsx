'use client';

// Rewards: add or edit a card (Hearth E1-E4). The first field picks the
// scheme: one the household already has, one from the starter list (which
// brings its stores), or a new name. Then the number and code type as in
// Groceries' rewards sheet, who can see it, and when it expires. Native twin:
// apps/mobile/src/features/rewards/card-form-sheet.tsx.
import { WalletCards } from 'lucide-react';
import {
  LOYALTY_CARD_FORMATS,
  useCardForm,
  type LoyaltyCard,
  type RewardsApi,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';

const REWARDS_SECTION = { id: 'rewards', Icon: WalletCards };

export function CardFormSheet({
  isOpen,
  onClose,
  card,
  rewards,
  groupId,
  currentUserId,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
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
      section={REWARDS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={card ? 'Edit card' : 'Add a card'}
      onSubmit={form.submit}
      submitLabel={card ? 'Save' : 'Add card'}
      onDelete={card ? () => { rewards.deleteCard(card.id); onClose(); } : undefined}
      deleteLabel="Remove card"
      deleteConfirmTitle={card ? `Remove ${card.name}?` : undefined}
      deleteConfirmMessage={card?.private ? 'Only you could see it.' : 'It goes for everyone in your household.'}
    >
      <FormSection>
        <FieldRow
          label="Card"
          htmlFor="reward-scheme"
          required
          error={form.nameError}
          hint={catalog ? `Comes with ${catalog.partners.length} ${catalog.partners.length === 1 ? 'store' : 'stores'}` : undefined}
        >
          <Input
            id="reward-scheme"
            autoFocus={!card}
            value={schemeName}
            onChange={(e) => {
              form.typeSchemeName(e.target.value);
            }}
            placeholder="Flybuys, auto club, gym"
            maxLength={80}
            autoComplete="off"
          />
          {(suggestions.own.length > 0 || suggestions.starters.length > 0) && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {suggestions.own.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => form.setSchemeName(s.name)}
                  className="min-h-9 rounded-full bg-muted px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {s.name}
                </button>
              ))}
              {suggestions.starters.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    form.pickStarter(e);
                  }}
                  className="min-h-9 rounded-full bg-muted px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {e.name}
                  <span className="ml-1 text-muted-foreground/70">· {e.partners.length}</span>
                </button>
              ))}
            </div>
          )}
        </FieldRow>
        <FieldRow label="Card number" htmlFor="reward-number" required error={tried ? numberError : null}>
          <Input
            id="reward-number"
            value={number}
            onChange={(e) => form.setNumber(e.target.value)}
            placeholder="6008 1234 5678 9012"
            className="font-mono"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FieldRow>
        <FieldRow label="Code" hint="Barcode suits most cards. Pick QR if the card shows a square code, or EAN-13 only if it says so.">
          <SegmentedControl options={LOYALTY_CARD_FORMATS} value={format} onChange={form.setFormat} ariaLabel="Code type" />
        </FieldRow>
        <FieldRow
          label="Who can see it"
          hint={canMakePrivate ? undefined : 'Only the person who added it can make it theirs alone.'}
        >
          <SegmentedControl
            options={form.visibilityOptions}
            value={visibility}
            onChange={form.setVisibility}
            ariaLabel="Who can see it"
          />
        </FieldRow>
        <FieldRow label="Expires" htmlFor="reward-expires">
          <Input id="reward-expires" type="date" value={expires} onChange={(e) => form.setExpires(e.target.value)} />
        </FieldRow>
        <FieldRow label="Notes" htmlFor="reward-notes" hint="Not for PINs or passwords.">
          <Input id="reward-notes" value={notes} onChange={(e) => form.setNotes(e.target.value)} placeholder="Optional" maxLength={200} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
