import { describe, expect, it } from 'vitest';
import { buildGiftIdea, buildOccasion, buildWishlistItem, type MemberProfileMap } from './occasions';
import {
  ideaForLabel,
  ideaRowMeta,
  nextOccasion,
  occasionFocusView,
  occasionsLede,
  othersWishlists,
  wishMeta,
  wishTakenLabel,
} from './occasions-view';

const ME = 'u-me';
const TEGAN = 'u-tegan';
const profiles: MemberProfileMap = {
  [ME]: { email: 'me@x.com', name: 'Guy B', avatar: null },
  [TEGAN]: { email: 't@x.com', name: 'Tegan Smith', avatar: null },
};
const TODAY = '2026-10-23';

const birthday = buildOccasion({ id: 'o1', groupId: 'g', title: "Tegan's birthday", kind: 'birthday', date: '1990-10-25', personId: TEGAN, createdBy: ME });
const past = buildOccasion({ id: 'o0', groupId: 'g', title: 'Party', kind: 'other', date: '2026-01-01', repeats: false, createdBy: ME });
const mine = buildOccasion({ id: 'o2', groupId: 'g', title: 'Guy birthday', kind: 'birthday', date: '1988-10-23', personId: ME, createdBy: TEGAN });

describe('occasionsLede', () => {
  it('counts days to the next occasion', () => {
    const next = nextOccasion([past, birthday], TODAY);
    expect(next?.id).toBe('o1');
    expect(occasionsLede(next, 2, TODAY, ME)).toEqual({ value: 2, label: 'days', caption: expect.stringMatching(/^Tegan's birthday · /) });
  });

  it('says Today and reads your own birthday as yours', () => {
    expect(occasionsLede(mine, 1, TODAY, ME)).toMatchObject({ value: 'Today', label: undefined, caption: expect.stringMatching(/^Your birthday · /) });
  });

  it('counts the occasions when nothing is coming up', () => {
    expect(occasionsLede(nextOccasion([past], TODAY), 1, TODAY, ME)).toEqual({ value: 1, label: 'occasion', caption: 'Nothing coming up' });
  });
});

describe('wishlists', () => {
  it('groups other members, skipping yours', () => {
    const w = (id: string, user: string) => buildWishlistItem({ id, groupId: 'g', userId: user, title: id });
    expect(othersWishlists([w('a', TEGAN), w('b', ME), w('c', TEGAN), w('d', 'u-sam')], ME).map(([u, items]) => [u, items.map((i) => i.id)])).toEqual([
      [TEGAN, ['a', 'c']],
      ['u-sam', ['d']],
    ]);
  });

  it('describes a wish and who is getting it', () => {
    expect(wishMeta({ price_cents: null, notes: 'Size 8' })).toBe('Size 8');
    expect(wishMeta({ price_cents: 1000, notes: 'Blue' })).toMatch(/10.* · Blue$/);
    expect(wishTakenLabel({ created_by: ME }, ME, profiles)).toBe("You're getting it");
    expect(wishTakenLabel({ created_by: TEGAN }, ME, profiles)).toBe('Tegan is getting it');
  });
});

describe('occasionFocusView', () => {
  const idea = (id: string, extra: Partial<Parameters<typeof buildGiftIdea>[0]> = {}) =>
    buildGiftIdea({ id, groupId: 'g', title: id, occasionId: 'o1', forUserId: TEGAN, hiddenFrom: [TEGAN], createdBy: ME, ...extra });

  it('heads the list with who it is kept from when every idea is', () => {
    const view = occasionFocusView(birthday, [idea('a'), idea('b'), idea('other', { occasionId: 'o9' })], ME, profiles);
    expect(view).toMatchObject({ own: false, allKept: true, heading: 'Ideas for Tegan', head: 'Kept from Tegan' });
    expect(view.ideas.map((i) => i.id)).toEqual(['a', 'b']);
    expect(ideaRowMeta(view.ideas[0], birthday, profiles, true)).not.toMatch(/Kept from/);
  });

  it('adds the budget, and names each idea kept when not all are', () => {
    const withBudget = { ...birthday, budget_cents: 5000 };
    const view = occasionFocusView(withBudget, [idea('a'), idea('b', { hiddenFrom: [] })], ME, profiles);
    expect(view.allKept).toBe(false);
    expect(view.head).toMatch(/50.* budget$/);
    expect(ideaRowMeta(view.ideas[0], withBudget, profiles, false)).toMatch(/Kept from Tegan$/);
  });

  it('keeps your own day to a title', () => {
    expect(occasionFocusView(mine, [], ME, profiles)).toMatchObject({ own: true, heading: 'Your birthday' });
  });

  it('names who an idea is for only when it is someone else', () => {
    expect(ideaForLabel(idea('a'), birthday, profiles)).toBeNull();
    expect(ideaForLabel(idea('b', { forUserId: null, forName: 'Mum' }), birthday, profiles)).toBe('for Mum');
  });
});
