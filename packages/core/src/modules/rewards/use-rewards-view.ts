'use client';

// Rewards: the screen and sheet state both apps share. The apps own how a
// sheet opens and closes (the phone waits for one to leave before the next),
// so these hooks hand back ids and callbacks instead of opening anything.

import { useCallback, useMemo, useState } from 'react';
import type { LoyaltyCard, LoyaltyCardFormat } from '../../types';
import { envRandomUUID } from '../../data/store-environment';
import { useHouseholdCurrency } from '../../currency';
import { todayISO } from '../../date-utils';
import { formatLoyaltyNumber, loyaltyNumberError, normalizeLoyaltyNumber } from './loyalty-cards';
import {
  brandKey,
  buildRewardPerk,
  cardExpiryCaption,
  cardsForStore,
  comparePerks,
  newPartnerNames,
  parsePartnerList,
  perkIsLive,
  perksEndingSoon,
  popularStores,
  rewardCatalogFor,
  storeCount,
  walletOrder,
  type RewardCatalogEntry,
  type RewardPartner,
  type RewardPerk,
  type RewardPerkKind,
  type RewardScheme,
  type StoreMatch,
} from './rewards';
import {
  cardSchemeSuggestions,
  knownStoreNames,
  perkDraftTitle,
  perkDraftValue,
  rewardsLede,
  storeMatchTarget,
  storeNameSuggestions,
  type RewardsTab,
} from './rewards-view';
import type { RewardsApi } from './use-rewards';

/** The Rewards screen: tab, store search, and what the wallet, matches and perks show. */
export function useRewardsScreen(rewards: RewardsApi, currentUserId: string | null | undefined) {
  const today = todayISO();
  const [tab, setTab] = useState<RewardsTab>('cards');
  const [query, setQuery] = useState('');

  const { cards, schemes, partners, perks } = rewards;
  const wallet = useMemo(() => walletOrder(cards, schemes), [cards, schemes]);
  const matches = useMemo(() => cardsForStore(query, rewards, today), [query, rewards, today]);
  const livePerks = useMemo(() => perks.filter((p) => perkIsLive(p, today)), [perks, today]);
  const ending = useMemo(() => perksEndingSoon(livePerks, today), [livePerks, today]);
  const quickStores = useMemo(() => popularStores(partners), [partners]);
  const schemeById = useMemo(() => new Map(schemes.map((s) => [s.id, s])), [schemes]);
  const partnerName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);

  const searching = tab === 'cards' && query.trim().length >= 2;
  const topWithCard = matches.find((m) => m.cards.length > 0);
  const lede = rewardsLede({ tab, searching, query, matches, livePerks, ending, schemes, cards, partners });

  const matchTarget = useCallback((m: StoreMatch) => storeMatchTarget(m, currentUserId), [currentUserId]);

  // A card from before Rewards (Groceries' sheet) has no scheme yet: give it
  // one named after the card, so it can gain stores and perks.
  const storesSchemeFor = useCallback(
    (card: LoyaltyCard): string | null => {
      const existing = rewards.schemeOf(card);
      if (existing) return existing.id;
      const id = rewards.addScheme({ name: card.name });
      if (!id) return null;
      rewards.saveCard({ ...card, scheme_id: id });
      return id;
    },
    [rewards],
  );

  return {
    today,
    tab,
    setTab,
    query,
    setQuery,
    wallet,
    matches,
    livePerks,
    ending,
    quickStores,
    schemeById,
    partnerName,
    searching,
    topWithCard,
    lede,
    matchTarget,
    storesSchemeFor,
  };
}

/** A card's sheet: the scheme's stores and live perks, and the caption under the code. */
export function useCardSheetDetail(input: {
  card: LoyaltyCard;
  scheme: RewardScheme | null;
  partners: RewardPartner[];
  perks: RewardPerk[];
  holder: string;
}) {
  const { card, scheme, partners, perks, holder } = input;
  const today = todayISO();
  const schemePartners = useMemo(() => partners.filter((p) => scheme && p.scheme_id === scheme.id), [partners, scheme]);
  const schemePerks = useMemo(
    () => perks.filter((p) => scheme && p.scheme_id === scheme.id && perkIsLive(p, today)).sort(comparePerks),
    [perks, scheme, today],
  );
  const partnerName = new Map(schemePartners.map((p) => [p.id, p.name]));
  const stores = storeCount(schemePartners);
  const caption = [holder, cardExpiryCaption(card.expires_on, today)].filter(Boolean).join(' · ');
  return { today, schemePartners, schemePerks, partnerName, stores, caption };
}

export type CardVisibility = 'shared' | 'private';
export const CARD_VISIBILITY: { value: CardVisibility; label: string }[] = [
  { value: 'shared', label: 'Everyone' },
  { value: 'private', label: 'Just me' },
];

/**
 * Add or edit a card. The first field picks the scheme: one the household
 * has, one from the starter list (which brings its stores), or a new name.
 */
export function useCardForm(input: {
  card?: LoyaltyCard;
  rewards: RewardsApi;
  groupId: string;
  currentUserId: string | null;
  onSaved: (card: LoyaltyCard) => void;
}) {
  const { card, rewards, groupId, currentUserId, onSaved } = input;
  const currency = useHouseholdCurrency();
  const current = card ? rewards.schemeOf(card) : null;
  const [schemeName, setSchemeName] = useState(current?.name ?? card?.name ?? '');
  const [catalog, setCatalog] = useState<RewardCatalogEntry | null>(null);
  const [number, setNumber] = useState(card ? formatLoyaltyNumber(card.number) : '');
  const [format, setFormat] = useState<LoyaltyCardFormat>(card?.format ?? 'code128');
  const [visibility, setVisibility] = useState<CardVisibility>(card?.private ? 'private' : 'shared');
  const [expires, setExpires] = useState(card?.expires_on ?? '');
  const [notes, setNotes] = useState(card?.notes ?? '');
  const [tried, setTried] = useState(false);

  // Only the person who added a card can make it theirs alone; anyone else
  // would hide it from themselves.
  const canMakePrivate = !card || card.created_by === currentUserId;
  const visibilityOptions = canMakePrivate ? CARD_VISIBILITY : CARD_VISIBILITY.filter((v) => v.value === 'shared');
  const normalized = normalizeLoyaltyNumber(number, format);
  const numberError = loyaltyNumberError(normalized, format);

  const suggestions = useMemo(
    () => cardSchemeSuggestions(schemeName, rewards.schemes, rewardCatalogFor(currency), catalog),
    [schemeName, rewards.schemes, currency, catalog],
  );

  /** Typing a name drops a picked starter entry. */
  const typeSchemeName = (text: string) => {
    setSchemeName(text);
    setCatalog(null);
  };
  const pickStarter = (entry: RewardCatalogEntry) => {
    setSchemeName(entry.name);
    setCatalog(entry);
  };

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
      : { id: envRandomUUID(), group_id: groupId, created_by: null, ...fields, deleted: false, created_at: '', updated_at: '' };
    rewards.saveCard(saved);
    onSaved(saved);
  };

  return {
    schemeName,
    setSchemeName,
    typeSchemeName,
    catalog,
    pickStarter,
    number,
    setNumber,
    format,
    setFormat,
    visibility,
    setVisibility,
    visibilityOptions,
    expires,
    setExpires,
    notes,
    setNotes,
    tried,
    canMakePrivate,
    numberError,
    nameError: tried && !schemeName.trim() ? 'Name the card' : null,
    suggestions,
    submit,
  };
}

/** A scheme's sheet: its name and website, stores in as chips or a pasted list, and its perks. */
export function useSchemeForm(input: { scheme: RewardScheme; rewards: RewardsApi; groupId: string }) {
  const { scheme, rewards, groupId } = input;
  const [name, setName] = useState(scheme.name);
  const [website, setWebsite] = useState(scheme.website ?? '');
  const [storeInput, setStoreInput] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  const stores = useMemo(
    () => rewards.partners.filter((p) => p.scheme_id === scheme.id).sort((a, b) => a.name.localeCompare(b.name)),
    [rewards.partners, scheme.id],
  );
  const perks = useMemo(() => rewards.perks.filter((p) => p.scheme_id === scheme.id).sort(comparePerks), [rewards.perks, scheme.id]);
  const storeName = new Map(stores.map((p) => [p.id, p.name]));

  // Suggestions: store names the household or the starter list already
  // knows, minus this scheme's own.
  const known = useMemo(() => knownStoreNames(rewards.partners), [rewards.partners]);
  const storeSuggestions = useMemo(() => storeNameSuggestions(storeInput, known, stores), [storeInput, known, stores]);
  const pastedNames = useMemo(() => newPartnerNames(parsePartnerList(pasted), stores), [pasted, stores]);

  const addStores = (names: string[]) => {
    rewards.addPartners(scheme.id, names);
    setStoreInput('');
  };
  const addPasted = () => {
    addStores(pastedNames);
    setPasted('');
    setPasting(false);
  };
  /** Keep the edits; a blank name keeps the old one. */
  const save = () => rewards.saveScheme({ ...scheme, name: name.trim() || scheme.name, website: website.trim() || null });
  const remove = () => rewards.deleteScheme(scheme.id);
  const addPerk = (perk: PerkInput) => rewards.savePerk(buildRewardPerk({ id: envRandomUUID(), groupId, schemeId: scheme.id, ...perk }));
  const storeOptions = stores.map((p) => ({ id: p.id, name: p.name }));

  return {
    name,
    setName,
    website,
    setWebsite,
    storeInput,
    setStoreInput,
    pasting,
    setPasting,
    pasted,
    setPasted,
    stores,
    storeOptions,
    perks,
    storeName,
    storeSuggestions,
    pastedNames,
    addStores,
    addPasted,
    save,
    remove,
    addPerk,
  };
}

export interface PerkInput {
  partnerId: string | null;
  title: string;
  kind: RewardPerkKind;
  value: number | null;
  conditions: string | null;
  validUntil: string | null;
}

/** The scheme sheet's Add perk form, collapsed until opened. */
export function usePerkForm(stores: { id: string; name: string }[], onAdd: (perk: PerkInput) => void) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RewardPerkKind>('percent');
  const [value, setValue] = useState('');
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [conditions, setConditions] = useState('');
  const [ends, setEnds] = useState('');

  const finalTitle = perkDraftTitle({ title, kind, value, partnerId }, stores);

  const add = () => {
    onAdd({
      partnerId,
      title: finalTitle,
      kind,
      value: kind === 'other' ? null : perkDraftValue(value),
      conditions: conditions.trim() || null,
      validUntil: ends || null,
    });
    setTitle('');
    setValue('');
    setConditions('');
    setEnds('');
    setOpen(false);
  };

  return {
    open,
    setOpen,
    title,
    setTitle,
    kind,
    setKind,
    value,
    setValue,
    partnerId,
    setPartnerId,
    conditions,
    setConditions,
    ends,
    setEnds,
    finalTitle,
    add,
  };
}
