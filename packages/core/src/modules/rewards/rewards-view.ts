// Rewards: the screen helpers both apps' Rewards screens and sheets share.
// The Hero lede, wallet captions, perk groups and the form suggestions live
// here; the apps keep their own rendering, sheets and haptics.

import type { LoyaltyCard } from '../../types';
import {
  REWARD_CATALOG,
  brandKey,
  comparePerks,
  matchedStoreName,
  newPartnerNames,
  searchRewardCatalog,
  storeCount,
  cardExpiryCaption,
  type RewardCatalogEntry,
  type RewardPartner,
  type RewardPerk,
  type RewardPerkKind,
  type RewardScheme,
  type StoreMatch,
} from './rewards';

export type RewardsTab = 'cards' | 'perks';
export const REWARDS_TABS: { value: RewardsTab; label: string }[] = [
  { value: 'cards', label: 'Cards' },
  { value: 'perks', label: 'Perks' },
];

export interface RewardsLede {
  value: number;
  label: string;
  caption: string;
}

/** The Hero lede (H1): perks on the Perks tab, the store answer while searching, else the wallet. */
export function rewardsLede(input: {
  tab: RewardsTab;
  searching: boolean;
  query: string;
  matches: StoreMatch[];
  livePerks: RewardPerk[];
  ending: RewardPerk[];
  schemes: RewardScheme[];
  cards: LoyaltyCard[];
  partners: RewardPartner[];
}): RewardsLede {
  const { tab, searching, query, matches, livePerks, ending, schemes, cards, partners } = input;
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
}

/** Who sees a card, as its face and sheet say it. */
export function cardHolderLabel(card: Pick<LoyaltyCard, 'private'>): string {
  return card.private ? 'Just me' : 'Shared';
}

/** A wallet face's detail line: how many stores, then when it expires. Empty when neither applies. */
export function walletCardDetail(
  card: Pick<LoyaltyCard, 'expires_on'>,
  scheme: Pick<RewardScheme, 'id'> | null,
  partners: RewardPartner[],
  today: string,
): string {
  const stores = scheme ? storeCount(partners, new Set([scheme.id])) : 0;
  return [stores ? `${stores} ${stores === 1 ? 'store' : 'stores'}` : null, cardExpiryCaption(card.expires_on, today)].filter(Boolean).join(' · ');
}

/** What tapping a store match opens: the viewer's own card first, any card, else the scheme. */
export function storeMatchTarget(
  match: StoreMatch,
  currentUserId: string | null | undefined,
): { kind: 'card'; id: string } | { kind: 'scheme'; id: string } {
  const mine = match.cards.find((c) => c.created_by === currentUserId) ?? match.cards[0];
  return mine ? { kind: 'card', id: mine.id } : { kind: 'scheme', id: match.scheme.id };
}

/** The Perks tab's groups under "Ending soon": one per scheme, by name, perks best first. */
export function perkListGroups(
  perks: RewardPerk[],
  ending: RewardPerk[],
  schemes: RewardScheme[],
): { scheme: RewardScheme; perks: RewardPerk[] }[] {
  const endingIds = new Set(ending.map((p) => p.id));
  return schemes
    .map((s) => ({ scheme: s, perks: perks.filter((p) => p.scheme_id === s.id && !endingIds.has(p.id)).sort(comparePerks) }))
    .filter((g) => g.perks.length > 0)
    .sort((a, b) => a.scheme.name.localeCompare(b.scheme.name));
}

/** A Perks tab row's meta: the scheme (under "Ending soon"), where it works, and its conditions. */
export function perkRowMeta(
  perk: RewardPerk,
  opts: { showScheme: boolean; schemeName: ReadonlyMap<string, string>; partnerName: ReadonlyMap<string, string> },
): string {
  const where = perk.partner_id ? opts.partnerName.get(perk.partner_id) : 'Every store';
  return [opts.showScheme ? opts.schemeName.get(perk.scheme_id) : null, where, perk.conditions].filter(Boolean).join(' · ');
}

/** A perk row's meta on a scheme's sheet: where, conditions, and when it ends. */
export function schemePerkMeta(
  perk: RewardPerk,
  storeName: ReadonlyMap<string, string>,
  endsCaption: string | null,
): string {
  const where = perk.partner_id ? storeName.get(perk.partner_id) : 'Every store';
  return [where, perk.conditions, endsCaption].filter(Boolean).join(' · ');
}

/** Store names the household or the starter list already knows, one per brand. */
export function knownStoreNames(partners: Pick<RewardPartner, 'brand_key' | 'name'>[], catalog: RewardCatalogEntry[] = REWARD_CATALOG): string[] {
  const names = new Map<string, string>();
  for (const p of partners) names.set(p.brand_key, p.name);
  for (const e of catalog) for (const p of e.partners) if (!names.has(brandKey(p.name))) names.set(brandKey(p.name), p.name);
  return [...names.values()];
}

/** Known store names starting with what's typed, minus the scheme's own stores. */
export function storeNameSuggestions(input: string, known: string[], stores: Pick<RewardPartner, 'brand_key'>[], limit = 5): string[] {
  const key = brandKey(input);
  if (!key) return [];
  return newPartnerNames(
    known.filter((n) => brandKey(n).startsWith(key)),
    stores,
  ).slice(0, limit);
}

/**
 * The card form's scheme chips: the household's schemes matching the name,
 * then starter-list entries it doesn't have yet. None once the name matches
 * exactly, unless a starter entry was picked.
 */
export function cardSchemeSuggestions(
  schemeName: string,
  schemes: RewardScheme[],
  starterCatalog: RewardCatalogEntry[],
  picked: RewardCatalogEntry | null,
): { own: RewardScheme[]; starters: RewardCatalogEntry[] } {
  const key = brandKey(schemeName);
  const own = schemes.filter((s) => !key || brandKey(s.name).startsWith(key));
  const ownKeys = new Set(schemes.map((s) => brandKey(s.name)));
  const starters = searchRewardCatalog(starterCatalog, schemeName).filter((e) => !ownKeys.has(brandKey(e.name)));
  const exact = own.some((s) => brandKey(s.name) === key) || starters.some((e) => brandKey(e.name) === key);
  if (exact && !picked) return { own: [], starters: [] };
  return { own: own.slice(0, 4), starters: picked ? [] : starters.slice(0, 4) };
}

export interface PerkDraft {
  title: string;
  kind: RewardPerkKind;
  value: string;
  partnerId: string | null;
}

/** The perk form's typed value as a number, or null when blank or not above 0. */
export function perkDraftValue(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The perk's title: what was typed, else one made from the kind, value and store. */
export function perkDraftTitle(draft: PerkDraft, stores: { id: string; name: string }[]): string {
  const numeric = perkDraftValue(draft.value);
  const storeLabel = stores.find((s) => s.id === draft.partnerId)?.name;
  const { kind } = draft;
  const fallbackTitle =
    kind === 'percent' && numeric ? `${numeric}% off` : kind === 'amount' && numeric ? 'Money off' : kind === 'points' ? 'Points' : '';
  return draft.title.trim() || (storeLabel ? `${fallbackTitle} at ${storeLabel}`.trim() : fallbackTitle);
}

/** The Add perk form's value field label and placeholder for a kind. */
export function perkValueField(kind: RewardPerkKind): { label: string; placeholder: string } {
  if (kind === 'percent') return { label: 'Percent', placeholder: '10' };
  if (kind === 'amount') return { label: 'Amount', placeholder: '5' };
  return { label: 'Times points', placeholder: '2' };
}
