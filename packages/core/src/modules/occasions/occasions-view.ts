// Occasions: the screen helpers both apps' Occasions screens share. The apps
// keep their own rows, sheets and how a wish link opens.

import { daysBetweenISO } from '../../date-utils';
import { formatMoney } from '../../money-format';
import {
  ideaStatusLine,
  ideasForOccasion,
  isOwnOccasion,
  keptFromLabel,
  memberFirstName,
  nextOccasionDay,
  occasionSpend,
  occasionTitle,
  personName,
  weekdayDayMonthLabel,
  type GiftIdea,
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
