// Occasions: the screen helpers both apps' Occasions screens share. The apps
// keep their own rows, sheets and how a wish link opens.

import { daysBetweenISO } from '../../date-utils';
import { formatMoney } from '../../money-format';
import type { RowMenu } from '../../row-actions';
import type { ShopperWant } from '../shopper/shopper';
import {
  GIFT_IDEA_STATUSES,
  ideaStatusLine,
  ideasForOccasion,
  isGiftSettled,
  isOwnOccasion,
  keptFromLabel,
  memberFirstName,
  nextOccasionDay,
  occasionKindLabel,
  occasionSpend,
  occasionTitle,
  occasionWhenLabel,
  personName,
  weekdayDayMonthLabel,
  type GiftIdea,
  type GiftIdeaStatus,
  type MemberProfileMap,
  type Occasion,
  type WishlistItem,
} from './occasions';

/** The first occasion still to come (the list is sorted soonest first), or null. */
export function nextOccasion(occasions: readonly Occasion[], today: string): Occasion | null {
  return occasions.find((o) => nextOccasionDay(o, today)) ?? null;
}

/** The Hero (H1): days to the next occasion, or how many there are with nothing coming up. */
export function occasionsLede(
  next: Occasion | null,
  occasionCount: number,
  today: string,
  me: string | null,
): { value: string | number; label?: string; caption: string } {
  const nextDay = next ? nextOccasionDay(next, today) : null;
  if (next && nextDay) {
    const days = daysBetweenISO(today, nextDay);
    return {
      value: days === 0 ? 'Today' : days,
      label: days === 0 ? undefined : days === 1 ? 'day' : 'days',
      caption: `${occasionTitle(next, me)} · ${weekdayDayMonthLabel(nextDay)}`,
    };
  }
  return { value: occasionCount, label: occasionCount === 1 ? 'occasion' : 'occasions', caption: 'Nothing coming up' };
}

/** Every other member's wishlist, in the order their first wish appears. */
export function othersWishlists(wishlist: readonly WishlistItem[], me: string | null): [string, WishlistItem[]][] {
  const byUser = new Map<string, WishlistItem[]>();
  for (const w of wishlist) {
    if (w.user_id === me) continue;
    byUser.set(w.user_id, [...(byUser.get(w.user_id) ?? []), w]);
  }
  return [...byUser.entries()];
}

/**
 * The occasion in focus: its heading, ideas, and the line over them ("Kept
 * from Tegan" when every idea is kept from the person it's for, then the
 * budget). On your own day, `own` is true and the ideas stay out of sight.
 */
export function occasionFocusView(occasion: Occasion, ideas: GiftIdea[], me: string, profiles: MemberProfileMap) {
  const own = isOwnOccasion(occasion, me);
  const list = ideasForOccasion(ideas, occasion.id);
  const who = personName({ userId: occasion.person_id, name: occasion.person_name }, profiles);
  const person = occasion.person_id && occasion.person_id !== me ? occasion.person_id : null;
  const allKept = !!person && list.length > 0 && list.every((i) => i.hidden_from.includes(person));
  const kept = allKept ? keptFromLabel([person], profiles) : null;
  const { spent } = occasionSpend(list);
  const budget = occasion.budget_cents
    ? spent
      ? `${formatMoney(spent)} of ${formatMoney(occasion.budget_cents)}`
      : `${formatMoney(occasion.budget_cents)} budget`
    : null;
  return {
    own,
    ideas: list,
    allKept,
    heading: own ? occasionTitle(occasion, me) : who ? `Ideas for ${who}` : occasion.title,
    head: [kept, budget].filter(Boolean).join(' · '),
  };
}

/** "for Sam", only when the idea is for someone other than the occasion's person (Christmas lists). */
export function ideaForLabel(idea: GiftIdea, occasion: Occasion, profiles: MemberProfileMap): string | null {
  if (idea.for_user_id && idea.for_user_id === occasion.person_id) return null;
  const name = personName({ userId: idea.for_user_id, name: idea.for_name }, profiles);
  return name ? `for ${name}` : null;
}

/** An idea row's meta under the focus block: status and price, who it's for, who it's kept from. */
export function ideaRowMeta(idea: GiftIdea, occasion: Occasion, profiles: MemberProfileMap, allKept: boolean): string {
  return [ideaStatusLine(idea, (c) => formatMoney(c)), ideaForLabel(idea, occasion, profiles), allKept ? null : keptFromLabel(idea.hidden_from, profiles)]
    .filter(Boolean)
    .join(' · ');
}

/** A wish row's meta: price, then notes. */
export function wishMeta(item: Pick<WishlistItem, 'price_cents' | 'notes'>): string {
  return [item.price_cents ? formatMoney(item.price_cents) : null, item.notes].filter(Boolean).join(' · ');
}

/** Who is getting a taken wish: "You're getting it" or "Sam is getting it". */
export function wishTakenLabel(taken: Pick<GiftIdea, 'created_by'>, me: string | null, profiles: MemberProfileMap): string {
  return taken.created_by === me ? "You're getting it" : `${memberFirstName(taken.created_by ?? '', profiles)} is getting it`;
}

// ── The gift idea card ──────────────────────────────────────────────────────

/** "Birthday in 17 days", "Christmas tomorrow", "Party has passed". */
function occasionWhenPhrase(occasion: Occasion, name: string, today: string): string {
  const when = occasionWhenLabel(occasion, today);
  if (when === 'Passed') return `${name} has passed`;
  if (when === 'Today' || when === 'Tomorrow') return `${name} ${when.toLowerCase()}`;
  return `${name} in ${when}`;
}

/**
 * The gift budget meter on an idea's card (Hearth: meters are local): what
 * the occasion's other settled gifts cost, and this idea on top. A bought
 * idea counts with the rest. Shares are of the budget, clamped to fit.
 */
export interface GiftBudgetMeter {
  budget: number;
  bought: number;
  thisIdea: number;
  total: number;
  over: boolean;
  boughtShare: number;
  ideaShare: number;
  /** "$129 of $200". */
  label: string;
  /** "Bought $50", "This idea $79": only the parts that are there. */
  legend: { part: 'bought' | 'idea'; label: string }[];
}

export function giftBudgetMeter(idea: GiftIdea, occasion: Occasion | null, ideas: readonly GiftIdea[]): GiftBudgetMeter | null {
  if (!occasion?.budget_cents || idea.occasion_id !== occasion.id) return null;
  const budget = occasion.budget_cents;
  const others = ideas.filter((i) => i.occasion_id === occasion.id && i.id !== idea.id);
  let bought = occasionSpend(others).spent;
  let thisIdea = idea.price_cents ?? 0;
  if (isGiftSettled(idea)) {
    bought += thisIdea;
    thisIdea = 0;
  }
  const total = bought + thisIdea;
  const boughtShare = Math.min(1, bought / budget);
  const ideaShare = Math.min(1 - boughtShare, thisIdea / budget);
  return {
    budget,
    bought,
    thisIdea,
    total,
    over: total > budget,
    boughtShare,
    ideaShare,
    label: `${formatMoney(total)} of ${formatMoney(budget)}`,
    legend: [
      bought ? { part: 'bought' as const, label: `Bought ${formatMoney(bought)}` } : null,
      thisIdea ? { part: 'idea' as const, label: `This idea ${formatMoney(thisIdea)}` } : null,
    ].filter((l): l is { part: 'bought' | 'idea'; label: string } => !!l),
  };
}

/**
 * What a gift idea's card shows: the name, who and what it's for, the price,
 * the budget meter, the best price its Shopper watch found, and where it came
 * from. Each part is edited in place on the card (useGiftIdeaCard).
 */
export function giftIdeaCardView(input: {
  idea: GiftIdea;
  occasion: Occasion | null;
  ideas: readonly GiftIdea[];
  want: Pick<ShopperWant, 'best_cents' | 'best_store'> | null;
  me: string | null;
  profiles: MemberProfileMap;
  today: string;
}) {
  const { idea, occasion, ideas, want, me, profiles, today } = input;
  const who = personName({ userId: idea.for_user_id, name: idea.for_name }, profiles);
  // "For Tegan · Birthday in 17 days": the occasion's own title would say Tegan twice.
  const samePerson = !!occasion?.person_id && occasion.person_id === idea.for_user_id;
  const occasionName = occasion ? (samePerson ? occasionKindLabel(occasion.kind) : occasionTitle(occasion, me)) : null;
  const occasionPart = occasion && occasionName ? occasionWhenPhrase(occasion, occasionName, today) : null;
  const context = [who ? `For ${who}` : null, occasionPart].filter(Boolean).join(' · ') || null;

  let bestPrice: string | null = null;
  let bestHint: string | null = null;
  if (want) {
    if (want.best_cents == null) bestPrice = 'Not checked yet';
    else {
      bestPrice = want.best_store ? `${formatMoney(want.best_cents)} at ${want.best_store}` : formatMoney(want.best_cents);
      const diff = (idea.price_cents ?? 0) - want.best_cents;
      if (idea.price_cents && diff > 0) bestHint = `${formatMoney(diff)} under your price`;
    }
  }

  return {
    title: idea.title,
    context,
    price: idea.price_cents ? formatMoney(idea.price_cents) : null,
    status: idea.status,
    settled: isGiftSettled(idea),
    kept: keptFromLabel(idea.hidden_from, profiles),
    meter: giftBudgetMeter(idea, occasion, ideas),
    bestPrice,
    bestHint,
    fromWishlist: idea.wishlist_item_id ? (who ? `From ${who}'s wishlist` : 'From a wishlist') : null,
    notes: idea.notes,
    url: idea.url,
  };
}

/**
 * A gift idea row's menu (Hearth §13.7): web right-click, phone long press.
 * Open the card, open its link, mark it bought (or not), where it's at, edit
 * every field, remove.
 */
export function giftIdeaRowMenu(
  idea: GiftIdea,
  h: {
    onOpen?: () => void;
    onOpenLink?: (url: string) => void;
    onStatus: (status: GiftIdeaStatus) => void;
    onEdit?: () => void;
    onRemove?: () => void;
  },
): RowMenu {
  const settled = isGiftSettled(idea);
  const current = GIFT_IDEA_STATUSES.find((s) => s.value === idea.status);
  return {
    title: idea.title,
    kind: 'Gift idea',
    actions: [
      h.onOpen && { id: 'open', label: 'Open', group: 'open', icon: 'open', run: h.onOpen },
      !!idea.url && h.onOpenLink && { id: 'link', label: 'Open link', group: 'open', icon: 'open', run: () => h.onOpenLink!(idea.url!) },
      settled
        ? { id: 'unbuy', label: 'Not bought yet', group: 'state', icon: 'undo', run: () => h.onStatus(idea.shopper_want_id ? 'watching' : 'idea') }
        : { id: 'bought', label: 'Mark bought', group: 'state', icon: 'done', run: () => h.onStatus('bought') },
      {
        id: 'status',
        label: "Where it's at",
        group: 'set',
        icon: 'status',
        value: current?.label,
        options: GIFT_IDEA_STATUSES.map((s) => ({ id: s.value, label: s.label, checked: s.value === idea.status, run: () => h.onStatus(s.value) })),
      },
      h.onEdit && { id: 'edit', label: 'Edit', group: 'edit', icon: 'edit', run: h.onEdit },
      h.onRemove && { id: 'remove', label: 'Remove idea', group: 'danger', icon: 'delete', run: h.onRemove },
    ],
  };
}

/** How many rows each Occasions list shows before "Show all" (Guy: the screen opened into one long list). */
export const OCCASIONS_PREVIEW = { ideas: 4, occasions: 4, wishes: 3 } as const;

/** The first `limit` rows unless the list is open, and how many are folded away. */
export function previewRows<T>(rows: readonly T[], limit: number, open: boolean): { shown: readonly T[]; more: number } {
  if (open || rows.length <= limit + 1) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, limit), more: rows.length - limit };
}
