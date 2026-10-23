// Rewards module: loyalty schemes, the stores they work at, and what they
// give you there. A scheme (Flybuys, an auto club) is entered once with its
// partner stores and perks; each person's card (the existing `loyalty_cards`
// rows, shared with Groceries) points at it. The store lookup answers the
// question the section is built around: "which of my cards works here?".
//
// Pure helpers only; both apps render from these.

import type { LoyaltyCard } from './types';
import { daysBetweenISO } from './date-utils';

export type RewardSchemeKind = 'loyalty' | 'membership' | 'discount' | 'card_perk' | 'other';

export interface RewardScheme {
  id: string;
  group_id: string;
  name: string;
  kind: RewardSchemeKind;
  website: string | null;
  /** Where the scheme lists its partner stores, kept for a later re-read. */
  partners_url: string | null;
  /** Card face colour as #rrggbb, or null to derive one from the name. */
  color: string | null;
  /** The starter-list entry this came from, if any. */
  catalog_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface RewardPartner {
  id: string;
  group_id: string;
  scheme_id: string;
  name: string;
  /** brandKey(name): what the store lookup matches on. */
  brand_key: string;
  category: string | null;
  online_only: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export type RewardPerkKind = 'percent' | 'amount' | 'points' | 'freebie' | 'other';

export interface RewardPerk {
  id: string;
  group_id: string;
  scheme_id: string;
  /** null = at every store the scheme works at. */
  partner_id: string | null;
  title: string;
  kind: RewardPerkKind;
  /** Percent for 'percent', currency units for 'amount', a multiplier for 'points'. */
  value: number | null;
  conditions: string | null;
  valid_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export const REWARD_SCHEME_KINDS: { value: RewardSchemeKind; label: string }[] = [
  { value: 'loyalty', label: 'Loyalty' },
  { value: 'membership', label: 'Membership' },
  { value: 'discount', label: 'Discount club' },
  { value: 'card_perk', label: 'Card perk' },
  { value: 'other', label: 'Other' },
];

export const REWARD_PERK_KINDS: { value: RewardPerkKind; label: string }[] = [
  { value: 'percent', label: '% off' },
  { value: 'amount', label: '$ off' },
  { value: 'points', label: 'Points' },
  { value: 'other', label: 'Other' },
];

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * The key a store matches on: lower case, no accents, punctuation, spaces or
 * a leading "the", so "BIG W", "Big-W" and "big w" are one store.
 */
export function brandKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Store names from pasted text: one per line, or split on commas, semicolons
 * and bullets. List markers ("1.", "-", "•") are dropped, as are blank and
 * sentence-length lines. Duplicates (by brandKey) keep their first spelling.
 */
export function parsePartnerList(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const piece of text.split(/[\n;,•·|]+/)) {
    const name = piece
      .replace(/^\s*(?:\d+[.)]|[-*–])\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.length > 60) continue;
    const key = brandKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** `names` minus any already in `existing` (by brandKey), in order, deduped. */
export function newPartnerNames(names: string[], existing: Pick<RewardPartner, 'brand_key'>[]): string[] {
  const seen = new Set(existing.map((p) => p.brand_key));
  const out: string[] = [];
  for (const name of names) {
    const key = brandKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}

// ── Builders ─────────────────────────────────────────────────────────────────

const unsaved = { created_by: null, created_at: '', updated_at: '', deleted: false } as const;

export function buildRewardScheme(input: {
  id: string;
  groupId: string;
  name: string;
  kind?: RewardSchemeKind;
  website?: string | null;
  partnersUrl?: string | null;
  color?: string | null;
  catalogId?: string | null;
}): RewardScheme {
  return {
    id: input.id,
    group_id: input.groupId,
    name: input.name.trim(),
    kind: input.kind ?? 'loyalty',
    website: input.website ?? null,
    partners_url: input.partnersUrl ?? null,
    color: input.color ?? null,
    catalog_id: input.catalogId ?? null,
    notes: null,
    ...unsaved,
  };
}

export function buildRewardPartner(input: {
  id: string;
  groupId: string;
  schemeId: string;
  name: string;
  category?: string | null;
}): RewardPartner {
  const name = input.name.trim();
  return {
    id: input.id,
    group_id: input.groupId,
    scheme_id: input.schemeId,
    name,
    brand_key: brandKey(name),
    category: input.category ?? null,
    online_only: false,
    ...unsaved,
  };
}

export function buildRewardPerk(input: {
  id: string;
  groupId: string;
  schemeId: string;
  partnerId: string | null;
  title: string;
  kind: RewardPerkKind;
  value: number | null;
  conditions?: string | null;
  validUntil?: string | null;
}): RewardPerk {
  return {
    id: input.id,
    group_id: input.groupId,
    scheme_id: input.schemeId,
    partner_id: input.partnerId,
    title: input.title.trim(),
    kind: input.kind,
    value: input.value,
    conditions: input.conditions?.trim() || null,
    valid_until: input.validUntil || null,
    ...unsaved,
  };
}

// ── Perks ────────────────────────────────────────────────────────────────────

/**
 * The perk's value as a fragment ("10% off", "$13.50 off", "2x points"), or
 * null when it has none. `symbol` is the household's currency symbol
 * (currencySymbol()), passed in so this file stays free of client state.
 */
export function perkValueLabel(perk: Pick<RewardPerk, 'kind' | 'value'>, symbol: string): string | null {
  const v = perk.value;
  if (perk.kind === 'freebie') return 'Free';
  if (v == null || !Number.isFinite(v) || v <= 0) return perk.kind === 'points' ? 'Points' : null;
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (perk.kind === 'percent') return `${n}% off`;
  if (perk.kind === 'amount') return `${symbol}${n} off`;
  if (perk.kind === 'points') return `${n}x points`;
  return null;
}

const KIND_RANK: Record<RewardPerkKind, number> = { percent: 4, amount: 3, freebie: 2, points: 1, other: 0 };

/** Sort order for "best perk first": percent, then money off, freebies, points; bigger first within a kind. */
export function comparePerks(a: RewardPerk, b: RewardPerk): number {
  return KIND_RANK[b.kind] - KIND_RANK[a.kind] || (b.value ?? 0) - (a.value ?? 0) || a.title.localeCompare(b.title);
}

/** Whether a perk still applies on `today` (no end date, or ends today or later). */
export function perkIsLive(perk: Pick<RewardPerk, 'valid_until'>, today: string): boolean {
  return !perk.valid_until || perk.valid_until >= today;
}

/** Live perks ending within `days`, soonest first. */
export function perksEndingSoon(perks: RewardPerk[], today: string, days = 30): RewardPerk[] {
  return perks
    .filter((p) => p.valid_until && perkIsLive(p, today) && daysBetweenISO(today, p.valid_until) <= days)
    .sort((a, b) => (a.valid_until ?? '').localeCompare(b.valid_until ?? ''));
}

/** "ends today", "12d left", or null when the end is more than `days` away or unset. */
export function perkEndsCaption(validUntil: string | null, today: string, days = 30): string | null {
  if (!validUntil) return null;
  const left = daysBetweenISO(today, validUntil);
  if (left < 0) return 'ended';
  if (left === 0) return 'ends today';
  return left <= days ? `${left}d left` : null;
}

/** A card's expiry as a short caption ("expires in 12d", "renews in 3 mo", "expired"), or null. */
export function cardExpiryCaption(expiresOn: string | null | undefined, today: string): string | null {
  if (!expiresOn) return null;
  const left = daysBetweenISO(today, expiresOn);
  if (left < 0) return 'expired';
  if (left === 0) return 'expires today';
  if (left <= 45) return `expires in ${left}d`;
  if (left <= 120) return `renews in ${Math.round(left / 30)} mo`;
  return null;
}

// ── The store lookup ─────────────────────────────────────────────────────────

export interface RewardsData {
  schemes: RewardScheme[];
  partners: RewardPartner[];
  perks: RewardPerk[];
  cards: LoyaltyCard[];
}

export interface StoreMatch {
  scheme: RewardScheme;
  /** The household's cards for this scheme (often one, sometimes one each). */
  cards: LoyaltyCard[];
  /** Partner stores of the scheme that matched the query. Empty when the scheme's own name matched. */
  partners: RewardPartner[];
  /** Perks that apply at the matched stores, best first. */
  perks: RewardPerk[];
  best: RewardPerk | null;
}

function nameMatches(query: string, name: string): boolean {
  const q = brandKey(query);
  if (q.length < 2) return false;
  const key = brandKey(name);
  if (key.startsWith(q)) return true;
  // Any later word ("liquor" finds "First Choice Liquor Market"), or, from
  // four letters, anywhere in the name ("works" finds "Officeworks").
  const words = name.toLowerCase().split(/[^a-z0-9]+/);
  return words.some((word) => word.length > 0 && word.startsWith(q)) || (q.length >= 4 && key.includes(q));
}

/**
 * Which schemes work at the store typed in `query`, best perk first. A
 * scheme matches through one of its partner stores, or by its own name (so
 * typing "Flybuys" finds the card). Schemes the household has no card for
 * still show, since a perk you could get is worth knowing.
 */
export function cardsForStore(query: string, data: RewardsData, today: string): StoreMatch[] {
  if (brandKey(query).length < 2) return [];
  const live = data.schemes.filter((s) => !s.deleted);
  const matches: StoreMatch[] = [];
  for (const scheme of live) {
    const partners = data.partners.filter((p) => !p.deleted && p.scheme_id === scheme.id && nameMatches(query, p.name));
    const byName = nameMatches(query, scheme.name);
    if (partners.length === 0 && !byName) continue;
    const partnerIds = new Set(partners.map((p) => p.id));
    const perks = data.perks
      .filter(
        (p) =>
          !p.deleted &&
          p.scheme_id === scheme.id &&
          perkIsLive(p, today) &&
          (p.partner_id === null || partnerIds.has(p.partner_id) || (byName && partners.length === 0)),
      )
      .sort(comparePerks);
    const cards = data.cards.filter((c) => !c.deleted && c.scheme_id === scheme.id);
    matches.push({ scheme, cards, partners, perks, best: perks[0] ?? null });
  }
  return matches.sort(
    (a, b) =>
      (a.best && b.best ? comparePerks(a.best, b.best) : a.best ? -1 : b.best ? 1 : 0) ||
      Number(b.cards.length > 0) - Number(a.cards.length > 0) ||
      a.scheme.name.localeCompare(b.scheme.name),
  );
}

/** The store the lede names: the one partner name every match shares, else the query as typed. */
export function matchedStoreName(query: string, matches: StoreMatch[]): string {
  const names = new Map<string, string>();
  for (const m of matches) for (const p of m.partners) names.set(p.brand_key, p.name);
  return names.size === 1 ? [...names.values()][0] : query.trim();
}

/** Distinct stores (by brandKey) across the given schemes' partners. */
export function storeCount(partners: RewardPartner[], schemeIds?: ReadonlySet<string>): number {
  const keys = new Set<string>();
  for (const p of partners) {
    if (p.deleted || (schemeIds && !schemeIds.has(p.scheme_id))) continue;
    keys.add(p.brand_key);
  }
  return keys.size;
}

/** Store names to offer as quick picks: the brands most schemes share, then by name. */
export function popularStores(partners: RewardPartner[], limit = 6): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const p of partners) {
    if (p.deleted || p.online_only) continue;
    const hit = counts.get(p.brand_key);
    if (hit) hit.n += 1;
    else counts.set(p.brand_key, { name: p.name, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => c.name);
}

// ── Card faces ───────────────────────────────────────────────────────────────

// Card faces wear their scheme's colour. It is content (like a grocery
// glyph), not a section hue, so it never colours chrome. Picked dark enough
// for white text on both themes.
export const CARD_FACE_COLORS = [
  '#1F4FA8',
  '#C8202F',
  '#E0602A',
  '#18284A',
  '#1E7A46',
  '#6B2C91',
  '#0E6E73',
  '#8A5A12',
  '#3A3F4A',
  '#A3245E',
] as const;

/** The colour a scheme's card face is drawn in: its own, or a stable pick from its name. */
export function cardFaceColor(scheme: Pick<RewardScheme, 'color' | 'name'> | null | undefined, fallbackName = ''): string {
  if (scheme?.color && /^#[0-9a-f]{6}$/i.test(scheme.color)) return scheme.color;
  const name = scheme?.name ?? fallbackName;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CARD_FACE_COLORS[h % CARD_FACE_COLORS.length];
}

/** A card's display name: its scheme's name, or the card's own. */
export function cardTitle(card: Pick<LoyaltyCard, 'name'>, scheme: Pick<RewardScheme, 'name'> | null | undefined): string {
  return scheme?.name ?? card.name;
}

/** Cards in wallet order: by scheme name (the card's own name without one), then number. */
export function walletOrder(cards: LoyaltyCard[], schemes: RewardScheme[]): LoyaltyCard[] {
  const byId = new Map(schemes.map((s) => [s.id, s]));
  const label = (c: LoyaltyCard) => (c.scheme_id ? byId.get(c.scheme_id)?.name : undefined) ?? c.name;
  return [...cards].sort(
    (a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base' }) || a.number.localeCompare(b.number),
  );
}

// ── Starter list ─────────────────────────────────────────────────────────────

export interface RewardCatalogEntry {
  id: string;
  /** ISO country the scheme runs in. */
  region: string;
  name: string;
  kind: RewardSchemeKind;
  website: string;
  color: string;
  /** Partner stores at the time of writing. People edit them after adding. */
  partners: { name: string; category?: string }[];
}

// Common schemes, so picking one fills its stores. Partner lists change, so
// they are a starting point the household can edit. Adding a country is a
// content-only change: more entries with its region.
export const REWARD_CATALOG: RewardCatalogEntry[] = [
  {
    id: 'au-flybuys',
    region: 'AU',
    name: 'Flybuys',
    kind: 'loyalty',
    website: 'https://www.flybuys.com.au',
    color: '#1F4FA8',
    partners: [
      { name: 'Coles', category: 'Groceries' },
      { name: 'Kmart', category: 'Shopping' },
      { name: 'Target', category: 'Shopping' },
      { name: 'Officeworks', category: 'Shopping' },
      { name: 'Liquorland', category: 'Liquor' },
      { name: 'First Choice Liquor Market', category: 'Liquor' },
    ],
  },
  {
    id: 'au-everyday-rewards',
    region: 'AU',
    name: 'Everyday Rewards',
    kind: 'loyalty',
    website: 'https://www.woolworthsrewards.com.au',
    color: '#E0602A',
    partners: [
      { name: 'Woolworths', category: 'Groceries' },
      { name: 'BIG W', category: 'Shopping' },
      { name: 'BWS', category: 'Liquor' },
      { name: 'Ampol', category: 'Fuel' },
    ],
  },
  {
    id: 'au-costco',
    region: 'AU',
    name: 'Costco',
    kind: 'membership',
    website: 'https://www.costco.com.au',
    color: '#C8202F',
    partners: [{ name: 'Costco', category: 'Groceries' }],
  },
  {
    id: 'au-ikea-family',
    region: 'AU',
    name: 'IKEA Family',
    kind: 'loyalty',
    website: 'https://www.ikea.com/au/en/ikea-family/',
    color: '#18284A',
    partners: [{ name: 'IKEA', category: 'Home' }],
  },
  {
    id: 'au-myer-one',
    region: 'AU',
    name: 'MYER one',
    kind: 'loyalty',
    website: 'https://www.myer.com.au/myerone',
    color: '#3A3F4A',
    partners: [{ name: 'Myer', category: 'Shopping' }],
  },
  {
    id: 'au-priceline-sister-club',
    region: 'AU',
    name: 'Priceline Sister Club',
    kind: 'loyalty',
    website: 'https://www.priceline.com.au/sister-club',
    color: '#A3245E',
    partners: [{ name: 'Priceline', category: 'Health' }],
  },
];

const REGION_BY_CURRENCY: Record<string, string> = { AUD: 'AU' };

/** Starter schemes for the household's currency's country, or none. */
export function rewardCatalogFor(currency: string): RewardCatalogEntry[] {
  const region = REGION_BY_CURRENCY[currency];
  return region ? REWARD_CATALOG.filter((e) => e.region === region) : [];
}

/** Starter entries whose name starts like `query` (all of them for a blank query). */
export function searchRewardCatalog(entries: RewardCatalogEntry[], query: string): RewardCatalogEntry[] {
  const q = brandKey(query);
  return q ? entries.filter((e) => brandKey(e.name).startsWith(q)) : entries;
}
