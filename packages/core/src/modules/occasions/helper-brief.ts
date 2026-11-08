// The Gifts helper's brief (module-helpers.ts): the birthdays and occasions
// coming up and where each gift stands, with no AI. The rows are facts that
// open Occasions. It never counts anything kept from the person (hidden_from):
// callers pass only what this person may see, and the helper's chat is never
// shared with the household (manifest share: never).

import type { BriefRow, BriefSection, HelperBrief } from '../../module-helpers';
import { daysToOccasion, occasionTitle, occasionWhenLabel, type GiftIdea, type Occasion } from './occasions';

/** Occasions within this many days are on the brief. */
export const GIFTS_BRIEF_DAYS = 60;

function ideasLine(ideas: readonly GiftIdea[]): string {
  const sorted = ideas.filter((i) => i.status === 'bought' || i.status === 'booked').length;
  if (!ideas.length) return 'No gift ideas yet';
  if (sorted) return sorted === ideas.length ? 'Gift sorted' : `${sorted} of ${ideas.length} ideas bought`;
  return ideas.length === 1 ? '1 idea, nothing bought' : `${ideas.length} ideas, nothing bought`;
}

export function giftsBrief(input: {
  /** What this person can see: nothing kept from them. */
  occasions: readonly Occasion[];
  ideas: readonly GiftIdea[];
  /** YYYY-MM-DD. */
  today: string;
  me?: string | null;
}): HelperBrief {
  const soon = input.occasions
    .filter((o) => o && !o.deleted)
    .map((o) => ({ o, days: daysToOccasion(o, input.today) }))
    .filter((x): x is { o: Occasion; days: number } => x.days != null && x.days >= 0 && x.days <= GIFTS_BRIEF_DAYS)
    .sort((a, b) => a.days - b.days);
  const ideasFor = (o: Occasion) => input.ideas.filter((i) => !i.deleted && i.occasion_id === o.id);
  const rows: BriefRow[] = soon.map(({ o, days }) => {
    const ideas = ideasFor(o);
    const unsorted = !ideas.some((i) => i.status === 'bought' || i.status === 'booked');
    return {
      kind: 'item',
      id: o.id,
      title: occasionTitle(o, input.me ?? null),
      meta: ideasLine(ideas),
      trailing: occasionWhenLabel(o, input.today),
      warn: unsorted && days <= 14,
      href: '/occasions',
    };
  });
  const sections: BriefSection[] = rows.length ? [{ id: 'soon', title: 'Coming up', rows }] : [];
  const unsorted = soon.filter(({ o }) => !ideasFor(o).some((i) => i.status === 'bought' || i.status === 'booked'));
  const next = soon[0];
  const lede = !soon.length
    ? `Nothing in the next ${GIFTS_BRIEF_DAYS} days.`
    : `${soon.length === 1 ? 'One occasion' : `${soon.length} occasions`} in the next ${GIFTS_BRIEF_DAYS} days` +
      (unsorted.length ? `, ${unsorted.length === soon.length ? 'none' : `${soon.length - unsorted.length}`} with a gift sorted.` : ', every gift sorted.') +
      (next ? ` Next up: ${occasionTitle(next.o, input.me ?? null)} (${occasionWhenLabel(next.o, input.today).toLowerCase()}).` : '');
  return { title: unsorted.some(({ days }) => days <= 14) ? 'A gift to sort soon' : 'Gifts coming up', lede, sections };
}
