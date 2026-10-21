'use client';

// Rewards: add or edit a card (Hearth E1-E4). The first field picks the
// scheme: one the household already has, one from the starter list (which
// brings its stores), or a new name. Then the number and code type as in
// Groceries' rewards sheet, who can see it, and when it expires. Native twin:
// apps/mobile/src/features/rewards/card-form-sheet.tsx.
import { useMemo, useState } from 'react';
import { WalletCards } from 'lucide-react';
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
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';

const REWARDS_SECTION = { id: 'rewards', Icon: WalletCards };

type Visibility = 'shared' | 'private';
const VISIBILITY = [
  { value: 'shared' as const, label: 'Everyone' },
  { value: 'private' as const, label: 'Just me' },
];

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
  const currency = useHouseholdCurrency();
  const current = card ? rewards.schemeOf(card) : null;
  const [schemeName, setSchemeName] = useState(current?.name ?? card?.name ?? '');
  const [catalog, setCatalog] = useState<RewardCatalogEntry | null>(null);
  const [number, setNumber] = useState(card ? formatLoyaltyNumber(card.number) : '');
  const [format, setFormat] = useState<LoyaltyCardFormat>(card?.format ?? 'code128');
  const [visibility, setVisibility] = useState<Visibility>(card?.private ? 'private' : 'shared');
  const [expires, setExpires] = useState(card?.expires_on ?? '');
  const [notes, setNotes] = useState(card?.notes ?? '');
  const [tried, setTried] = useState(false);

  // Only the person who added a card can make it theirs alone; anyone else
  // would hide it from themselves.
  const canMakePrivate = !card || card.created_by === currentUserId;
  const normalized = normalizeLoyaltyNumber(number, format);
  const numberError = loyaltyNumberError(normalized, format);

  const suggestions = useMemo(() => {
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
      : { id: crypto.randomUUID(), group_id: groupId, created_by: null, ...fields, deleted: false, created_at: '', updated_at: '' };
    rewards.saveCard(saved);
    onSaved(saved);
  };

  return (
    <ItemFormSheet
      section={REWARDS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={card ? 'Edit card' : 'Add a card'}
      onSubmit={submit}
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
          error={tried && !schemeName.trim() ? 'Name the card' : null}
          hint={catalog ? `Comes with ${catalog.partners.length} ${catalog.partners.length === 1 ? 'store' : 'stores'}` : undefined}
        >
          <Input
            id="reward-scheme"
            autoFocus={!card}
            value={schemeName}
            onChange={(e) => {
              setSchemeName(e.target.value);
              setCatalog(null);
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
                  onClick={() => setSchemeName(s.name)}
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
                    setSchemeName(e.name);
                    setCatalog(e);
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
            onChange={(e) => setNumber(e.target.value)}
            placeholder="6008 1234 5678 9012"
            className="font-mono"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FieldRow>
        <FieldRow label="Code" hint="Barcode suits most cards. Pick QR if the card shows a square code, or EAN-13 only if it says so.">
          <SegmentedControl options={LOYALTY_CARD_FORMATS} value={format} onChange={setFormat} ariaLabel="Code type" />
        </FieldRow>
        <FieldRow
          label="Who can see it"
          hint={canMakePrivate ? undefined : 'Only the person who added it can make it theirs alone.'}
        >
          <SegmentedControl
            options={canMakePrivate ? VISIBILITY : VISIBILITY.filter((v) => v.value === 'shared')}
            value={visibility}
            onChange={setVisibility}
            ariaLabel="Who can see it"
          />
        </FieldRow>
        <FieldRow label="Expires" htmlFor="reward-expires">
          <Input id="reward-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </FieldRow>
        <FieldRow label="Notes" htmlFor="reward-notes" hint="Not for PINs or passwords.">
          <Input id="reward-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" maxLength={200} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
