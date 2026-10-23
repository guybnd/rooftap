// Occasions: birthdays, anniversaries and other yearly days, the gift ideas
// for them, and each member's wishlist. Money is integer minor units (cents),
// like Costs. Everything here is pure so web, mobile and the server agree.
//
// "Keep it from": a gift idea (or a whole occasion) lists the members it is
// hidden from in hidden_from, and the database drops the row for them
// (migration 20261023100000_occasions). What an idea makes in modules that
// aren't hidden per person says only "Gift": the budget line until the day
// has passed, and a Shopper watch carries the same hidden_from.

import type { CostItem } from '../../types';
import { addDaysISO, daysBetweenISO } from '../../date-utils';
import { buildShopperWant, type ShopperWant } from '../shopper/shopper';

export type OccasionKind = 'birthday' | 'anniversary' | 'holiday' | 'other';

export const OCCASION_KINDS: readonly { value: OccasionKind; label: string }[] = [
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'other', label: 'Other' },
];

export interface Occasion {
  id: string;
  group_id: string;
  title: string;
  kind: OccasionKind;
  /** YYYY-MM-DD. With `repeats`, every year on that month and day. */
  date: string;
  repeats: boolean;
  /** The member it is for, if any. */
  person_id: string | null;
  /** Or a name for someone outside the household (Mum, Jess). */
  person_name: string | null;
  budget_cents: number | null;
  notes: string | null;
  /** Members it is kept from (a surprise party). */
  hidden_from: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export type GiftIdeaStatus = 'idea' | 'watching' | 'bought' | 'booked';

export const GIFT_IDEA_STATUSES: readonly { value: GiftIdeaStatus; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'watching', label: 'Watching' },
  { value: 'bought', label: 'Bought' },
  { value: 'booked', label: 'Booked' },
];

export interface GiftIdea {
  id: string;
  group_id: string;
  occasion_id: string | null;
  /** The member it is for, if any. */
  for_user_id: string | null;
  /** Or a name for someone outside the household. */
  for_name: string | null;
  title: string;
  status: GiftIdeaStatus;
  price_cents: number | null;
  url: string | null;
  notes: string | null;
  /** The wishlist item it answers, when someone took one. */
  wishlist_item_id: string | null;
  /** Its Shopper watch (occasions.shopper), hidden from the same people. */
  shopper_want_id: string | null;
  /** Its budget line (occasions.costs), named "Gift" until the day has passed. */
  cost_item_id: string | null;
  /** Members it is kept from. The database hides the row from them. */
  hidden_from: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface WishlistItem {
  id: string;
  group_id: string;
  /** Whose wishlist it is. Everyone can read it; only they change it. */
  user_id: string;
  title: string;
  url: string | null;
  price_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export type MemberProfileMap = Record<string, { email: string; name: string | null; avatar: string | null } | undefined>;

// ── Dates ───────────────────────────────────────────────────────────────────

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The occasion's day in `year`. A 29 February falls on the 28th in other years. */
export function occasionDayIn(date: string, year: number): string {
  const [, m, d] = parts(date);
  const day = m === 2 && d === 29 && !isLeap(year) ? 28 : d;
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The next time it falls, today included. Null for a one-off day that has passed. */
export function nextOccasionDay(occasion: Pick<Occasion, 'date' | 'repeats'>, today: string): string | null {
  if (!occasion.repeats) return occasion.date >= today ? occasion.date : null;
  const [year] = parts(today);
  const [firstYear] = parts(occasion.date);
  const thisYear = occasionDayIn(occasion.date, Math.max(year, firstYear));
  return thisYear >= today ? thisYear : occasionDayIn(occasion.date, Math.max(year, firstYear) + 1);
}

/** The last time it fell, before today. Null when it hasn't happened yet. */
export function previousOccasionDay(occasion: Pick<Occasion, 'date' | 'repeats'>, today: string): string | null {
  if (!occasion.repeats) return occasion.date < today ? occasion.date : null;
  const [year] = parts(today);
  const thisYear = occasionDayIn(occasion.date, year);
  const prev = thisYear < today ? thisYear : occasionDayIn(occasion.date, year - 1);
  return prev >= occasion.date ? prev : null;
}

/** Whole days until it next falls (0 = today), or null when it won't again. */
export function daysToOccasion(occasion: Pick<Occasion, 'date' | 'repeats'>, today: string): number | null {
  const next = nextOccasionDay(occasion, today);
  return next ? daysBetweenISO(today, next) : null;
}

/** Soonest first; one-off days that have passed go last, newest first. */
export function sortOccasions<T extends Pick<Occasion, 'date' | 'repeats' | 'title'>>(occasions: T[], today: string): T[] {
  const key = (o: T) => nextOccasionDay(o, today);
  return [...occasions].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka && kb) return ka.localeCompare(kb) || a.title.localeCompare(b.title);
    if (ka) return -1;
    if (kb) return 1;
    return b.date.localeCompare(a.date);
  });
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Nov". */
export function dayMonthLabel(iso: string): string {
  const [, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Sat 15 Nov". */
export function weekdayDayMonthLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** The trailing "when": Today, Tomorrow, 23 days, or the month once it is over 99 days off. */
export function occasionWhenLabel(occasion: Pick<Occasion, 'date' | 'repeats'>, today: string): string {
  const next = nextOccasionDay(occasion, today);
  if (!next) return 'Passed';
  const days = daysBetweenISO(today, next);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 99) return `${days} days`;
  return MONTHS[parts(next)[1] - 1];
}

// ── People ──────────────────────────────────────────────────────────────────

/** A member's first name, or "Someone" for a former member. */
export function memberFirstName(userId: string, profiles: MemberProfileMap): string {
  const p = profiles[userId];
  const full = p?.name?.trim() || p?.email?.split('@')[0] || '';
  return full.split(/\s+/)[0] || 'Someone';
}

/** Who an occasion or idea is for, as a name: the member's first name, the typed name, or null. */
export function personName(
  person: { userId: string | null; name: string | null },
  profiles: MemberProfileMap,
): string | null {
  if (person.userId) return memberFirstName(person.userId, profiles);
  return person.name?.trim() || null;
}

/** An occasion's title as this person reads it: "Your birthday" on their own. */
export function occasionTitle(occasion: Pick<Occasion, 'title' | 'kind' | 'person_id'>, me: string | null): string {
  if (me && occasion.person_id === me && occasion.kind === 'birthday') return 'Your birthday';
  return occasion.title;
}

/** A title for a new occasion from its kind and person: "Tegan's birthday". */
export function suggestedOccasionTitle(kind: OccasionKind, person: string | null): string {
  const label = OCCASION_KINDS.find((k) => k.value === kind)?.label ?? 'Occasion';
  if (!person) return kind === 'anniversary' ? 'Our anniversary' : '';
  return `${person}'s ${label.toLowerCase()}`;
}

/** Whether this is the viewer's own day: they see their wishlist there, never an ideas list. */
export function isOwnOccasion(occasion: Pick<Occasion, 'person_id'>, me: string | null): boolean {
  return !!me && occasion.person_id === me;
}

/**
 * Who a new gift idea is kept from by default: the member it is for, when
 * that is someone else in the household. Nobody for a gift for a name or for
 * yourself.
 */
export function defaultHiddenFrom(forUserId: string | null, me: string | null, memberIds: readonly string[]): string[] {
  if (!forUserId || forUserId === me || !memberIds.includes(forUserId)) return [];
  return [forUserId];
}

/** "Kept from Tegan", "Kept from Tegan and Sam", or null when nobody. */
export function keptFromLabel(hiddenFrom: readonly string[] | null | undefined, profiles: MemberProfileMap): string | null {
  if (!hiddenFrom?.length) return null;
  const names = hiddenFrom.map((id) => memberFirstName(id, profiles));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Kept from ${list}`;
}

/**
 * Whether saving `next` over `prev` hides the row from someone who could see
 * it. Their device may already hold a copy, and once the row is hidden the
 * database sends them no more changes to it, so the row is replaced: the old
 * one is removed while they can still see it, and a new one is written.
 */
export function hidesFromSomeoneNew(prev: readonly string[] | null | undefined, next: readonly string[]): boolean {
  const before = new Set(prev ?? []);
  return next.some((id) => !before.has(id));
}

// ── Ideas and budget ────────────────────────────────────────────────────────

/** Ideas for one occasion, newest last; bought and booked after the open ones. */
export function ideasForOccasion(ideas: GiftIdea[], occasionId: string): GiftIdea[] {
  const rank: Record<GiftIdeaStatus, number> = { booked: 2, bought: 2, watching: 1, idea: 0 };
  return ideas
    .filter((i) => i.occasion_id === occasionId)
    .sort((a, b) => rank[b.status] - rank[a.status] || a.created_at.localeCompare(b.created_at));
}

/** Bought or booked: the money is spent. */
export function isGiftSettled(idea: Pick<GiftIdea, 'status'>): boolean {
  return idea.status === 'bought' || idea.status === 'booked';
}

/** What the ideas you can see add up to: spent (bought or booked) and planned (everything with a price). */
export function occasionSpend(ideas: Pick<GiftIdea, 'status' | 'price_cents'>[]): { spent: number; planned: number } {
  let spent = 0;
  let planned = 0;
  for (const i of ideas) {
    const price = i.price_cents ?? 0;
    planned += price;
    if (isGiftSettled(i)) spent += price;
  }
  return { spent, planned };
}

/** "Booked · $140", "Idea". */
export function ideaStatusLine(idea: Pick<GiftIdea, 'status' | 'price_cents'>, format: (cents: number) => string): string {
  const label = GIFT_IDEA_STATUSES.find((s) => s.value === idea.status)?.label ?? 'Idea';
  return idea.price_cents ? `${label} · ${format(idea.price_cents)}` : label;
}

/** "8 Dec · 2 ideas", "14 Feb · shared", "3 Mar · 1 idea, kept from Guy". */
export function occasionSubtitle(
  occasion: Occasion,
  ideas: GiftIdea[],
  me: string | null,
  profiles: MemberProfileMap,
): string {
  const day = dayMonthLabel(occasion.date);
  if (isOwnOccasion(occasion, me)) return day;
  const mine = ideas.filter((i) => i.occasion_id === occasion.id);
  if (mine.length === 0) {
    if (!occasion.person_id && !occasion.person_name) return `${day} · shared`;
    return day;
  }
  const count = `${mine.length} ${mine.length === 1 ? 'idea' : 'ideas'}`;
  const kept = keptFromLabel(occasion.person_id ? mine.find((i) => i.hidden_from.length)?.hidden_from : null, profiles);
  return kept ? `${day} · ${count}, ${kept.replace(/^Kept/, 'kept')}` : `${day} · ${count}`;
}

/**
 * Whether a kept gift's day has passed since it was bought: the occasion
 * fell after `boughtOn` and before today. Until then the shared budget calls
 * it only "Gift".
 */
export function surpriseOver(occasion: Pick<Occasion, 'date' | 'repeats'> | null, boughtOn: string, today: string): boolean {
  if (!occasion) return false;
  const prev = previousOccasionDay(occasion, today);
  return !!prev && prev >= boughtOn;
}

/** The budget line's name: "Gift" while it is kept from someone and the day hasn't passed, else the idea. */
export function giftCostName(
  idea: Pick<GiftIdea, 'title' | 'hidden_from'>,
  occasion: Pick<Occasion, 'date' | 'repeats'> | null,
  boughtOn: string,
  today: string,
): string {
  if (idea.hidden_from.length > 0 && !surpriseOver(occasion, boughtOn, today)) return 'Gift';
  return idea.title;
}

/** The idea's Budget line (occasions.costs): a one-off Purchase on the day it went in, no store. */
export function buildGiftCost(input: {
  id: string;
  idea: Pick<GiftIdea, 'group_id' | 'title' | 'hidden_from'>;
  occasion: Pick<Occasion, 'date' | 'repeats'> | null;
  amountCents: number;
  today: string;
  createdBy?: string | null;
}): CostItem {
  const now = new Date().toISOString();
  return {
    id: input.id,
    group_id: input.idea.group_id,
    name: giftCostName(input.idea, input.occasion, input.today, input.today),
    category: 'purchase',
    amount: input.amountCents,
    cadence: 'one_off',
    is_estimate: false,
    start_date: input.today,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: 'occasions',
    notes: null,
    sort_order: 0,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export type GiftCostChange =
  | { kind: 'none' }
  | { kind: 'create'; cost: CostItem }
  | { kind: 'update'; id: string; patch: Pick<CostItem, 'name' | 'amount'> }
  | { kind: 'remove'; id: string };

/**
 * What saving an idea does to its Budget line. A line exists while the idea
 * is in the budget with a price. Returns the idea to write, with its link set
 * or cleared.
 */
export function planGiftCost<I extends Pick<GiftIdea, 'group_id' | 'title' | 'hidden_from' | 'price_cents' | 'cost_item_id'>>(input: {
  idea: I;
  inBudget: boolean;
  occasion: Pick<Occasion, 'date' | 'repeats'> | null;
  existing: Pick<CostItem, 'id' | 'name' | 'amount' | 'start_date'> | null;
  newId: () => string;
  today: string;
  createdBy?: string | null;
}): { idea: I; change: GiftCostChange } {
  const { idea, existing } = input;
  const amount = input.inBudget && idea.price_cents && idea.price_cents > 0 ? idea.price_cents : null;
  if (amount === null) {
    if (existing) return { idea: { ...idea, cost_item_id: null }, change: { kind: 'remove', id: existing.id } };
    return { idea: idea.cost_item_id ? { ...idea, cost_item_id: null } : idea, change: { kind: 'none' } };
  }
  if (existing) {
    const linked = { ...idea, cost_item_id: existing.id };
    const name = giftCostName(idea, input.occasion, existing.start_date ?? input.today, input.today);
    if (existing.amount === amount && existing.name === name) return { idea: linked, change: { kind: 'none' } };
    return { idea: linked, change: { kind: 'update', id: existing.id, patch: { name, amount } } };
  }
  const cost = buildGiftCost({ id: input.newId(), idea, occasion: input.occasion, amountCents: amount, today: input.today, createdBy: input.createdBy });
  return { idea: { ...idea, cost_item_id: cost.id }, change: { kind: 'create', cost } };
}

/**
 * Budget lines whose surprise is over: the line still says "Gift" but the
 * day has passed, so it can take the idea's name.
 */
export function giftCostsToReveal(
  ideas: GiftIdea[],
  occasions: Map<string, Occasion>,
  costs: Map<string, Pick<CostItem, 'id' | 'name' | 'start_date' | 'deleted'>>,
  today: string,
): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const idea of ideas) {
    if (!idea.cost_item_id || idea.hidden_from.length === 0) continue;
    const cost = costs.get(idea.cost_item_id);
    if (!cost || cost.deleted || cost.name !== 'Gift') continue;
    const occasion = idea.occasion_id ? occasions.get(idea.occasion_id) ?? null : null;
    const name = giftCostName(idea, occasion, cost.start_date ?? today, today);
    if (name !== cost.name) out.push({ id: cost.id, name });
  }
  return out;
}

/** "Watch the price" (occasions.shopper): a Shopper watch kept from the same people, needed by the day. */
export function buildGiftWant(input: {
  id: string;
  idea: Pick<GiftIdea, 'group_id' | 'title' | 'price_cents' | 'hidden_from'>;
  occasion: Pick<Occasion, 'date' | 'repeats'> | null;
  today: string;
  createdBy: string | null;
}): ShopperWant {
  const next = input.occasion ? nextOccasionDay(input.occasion, input.today) : null;
  return {
    ...buildShopperWant({
      id: input.id,
      groupId: input.idea.group_id,
      title: input.idea.title,
      budgetCents: input.idea.price_cents || null,
      // A few days ahead, so it arrives in time.
      needBy: next ? addDaysISO(next, -3) : null,
      createdBy: input.createdBy,
    }),
    hidden_from: [...input.idea.hidden_from],
  };
}

/** The visible idea that took a wishlist item, if any. Its owner never sees one. */
export function takenBy(item: Pick<WishlistItem, 'id'>, ideas: GiftIdea[]): GiftIdea | null {
  return ideas.find((i) => i.wishlist_item_id === item.id) ?? null;
}

/** The occasion an idea for a member's wishlist item goes under: their next birthday, if the household has one. */
export function wishlistOccasion(userId: string, occasions: Occasion[], today: string): Occasion | null {
  const theirs = occasions.filter((o) => o.person_id === userId && o.kind === 'birthday');
  return sortOccasions(theirs, today).find((o) => nextOccasionDay(o, today)) ?? null;
}

export function buildOccasion(input: {
  id: string;
  groupId: string;
  title: string;
  kind: OccasionKind;
  date: string;
  repeats?: boolean;
  personId?: string | null;
  personName?: string | null;
  budgetCents?: number | null;
  notes?: string | null;
  hiddenFrom?: string[];
  createdBy: string | null;
}): Occasion {
  const now = new Date().toISOString();
  return {
    id: input.id,
    group_id: input.groupId,
    title: input.title.trim(),
    kind: input.kind,
    date: input.date,
    repeats: input.repeats ?? true,
    person_id: input.personId ?? null,
    person_name: input.personId ? null : input.personName?.trim() || null,
    budget_cents: input.budgetCents ?? null,
    notes: input.notes?.trim() || null,
    hidden_from: input.hiddenFrom ?? [],
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export function buildGiftIdea(input: {
  id: string;
  groupId: string;
  title: string;
  occasionId: string | null;
  forUserId?: string | null;
  forName?: string | null;
  status?: GiftIdeaStatus;
  priceCents?: number | null;
  url?: string | null;
  notes?: string | null;
  wishlistItemId?: string | null;
  hiddenFrom: string[];
  createdBy: string | null;
}): GiftIdea {
  const now = new Date().toISOString();
  return {
    id: input.id,
    group_id: input.groupId,
    occasion_id: input.occasionId,
    for_user_id: input.forUserId ?? null,
    for_name: input.forUserId ? null : input.forName?.trim() || null,
    title: input.title.trim(),
    status: input.status ?? 'idea',
    price_cents: input.priceCents ?? null,
    url: input.url?.trim() || null,
    notes: input.notes?.trim() || null,
    wishlist_item_id: input.wishlistItemId ?? null,
    shopper_want_id: null,
    cost_item_id: null,
    hidden_from: input.hiddenFrom,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export function buildWishlistItem(input: {
  id: string;
  groupId: string;
  userId: string;
  title: string;
  url?: string | null;
  priceCents?: number | null;
  notes?: string | null;
}): WishlistItem {
  const now = new Date().toISOString();
  return {
    id: input.id,
    group_id: input.groupId,
    user_id: input.userId,
    title: input.title.trim(),
    url: input.url?.trim() || null,
    price_cents: input.priceCents ?? null,
    notes: input.notes?.trim() || null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

// ── Sheet copy ──────────────────────────────────────────────────────────────

/** "Tegan", "Tegan and Sam", "Tegan, Sam and Jo". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The day a kept gift's Budget line takes its name: the day after the occasion. */
export function revealDay(occasion: Pick<Occasion, 'date' | 'repeats'> | null, today: string): string | null {
  const next = occasion ? nextOccasionDay(occasion, today) : null;
  return next ? addDaysISO(next, 1) : null;
}

/** What "Keep it from" does, under the switches, when it keeps the idea from someone. */
export function keepFromHints(input: { names: readonly string[]; revealOn: string | null; budget: boolean }): string[] {
  if (input.names.length === 0) return [];
  const who = nameList(input.names);
  const lines = [`${who} won't see it, or its price watch`];
  if (input.budget) lines.push(input.revealOn ? `The budget says "Gift" until ${dayMonthLabel(input.revealOn)}` : 'The budget says "Gift"');
  lines.push(`The Assistant won't bring it up with ${who}`);
  return lines;
}

/** Shown with "In the budget" on a kept gift: a bank can't hide a payment. */
export const JOINT_ACCOUNT_GIFT_WARNING =
  'Paying from a joint bank account? The bank still shows the store to everyone on that account.';
