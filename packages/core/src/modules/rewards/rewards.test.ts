import { describe, expect, it } from 'vitest';
import {
  brandKey,
  buildRewardPartner,
  buildRewardPerk,
  buildRewardScheme,
  cardExpiryCaption,
  cardFaceColor,
  cardsForStore,
  matchedStoreName,
  newPartnerNames,
  parsePartnerList,
  perkEndsCaption,
  perkValueLabel,
  perksEndingSoon,
  popularStores,
  rewardCatalogFor,
  searchRewardCatalog,
  storeCount,
  type RewardsData,
} from './rewards';
import type { LoyaltyCard } from '../../types';

const G = 'g1';
const TODAY = '2026-10-21';

function card(id: string, schemeId: string | null, name = 'Card'): LoyaltyCard {
  return {
    id,
    group_id: G,
    created_by: 'u1',
    name,
    number: `60080000${id}`,
    format: 'code128',
    scheme_id: schemeId,
    private: false,
    created_at: 'x',
    updated_at: 'x',
    deleted: false,
  };
}

function fixture(): RewardsData {
  const flybuys = buildRewardScheme({ id: 's-fly', groupId: G, name: 'Flybuys' });
  const club = buildRewardScheme({ id: 's-club', groupId: G, name: 'Auto club', kind: 'membership' });
  const work = buildRewardScheme({ id: 's-work', groupId: G, name: 'Work perks' });
  const p = (id: string, schemeId: string, name: string) => buildRewardPartner({ id, groupId: G, schemeId, name });
  const partners = [
    p('p1', 's-fly', 'Coles'),
    p('p2', 's-fly', 'Officeworks'),
    p('p3', 's-club', 'Officeworks'),
    p('p4', 's-club', 'Hoyts'),
    p('p5', 's-work', 'Officeworks'),
    p('p6', 's-fly', 'First Choice Liquor Market'),
  ];
  const perk = (id: string, schemeId: string, partnerId: string | null, kind: 'percent' | 'amount' | 'points', value: number, validUntil?: string) =>
    buildRewardPerk({ id, groupId: G, schemeId, partnerId, title: id, kind, value, validUntil });
  const perks = [
    perk('fly-points', 's-fly', null, 'points', 1),
    perk('club-ow', 's-club', 'p3', 'percent', 5),
    perk('club-hoyts', 's-club', 'p4', 'amount', 13.5),
    perk('work-ow', 's-work', 'p5', 'amount', 10, '2026-11-02'),
    perk('work-old', 's-work', 'p5', 'percent', 50, '2026-10-01'),
  ];
  return {
    schemes: [flybuys, club, work],
    partners,
    perks,
    cards: [card('c1', 's-fly'), card('c2', 's-club'), card('c3', 's-fly')],
  };
}

describe('brandKey', () => {
  it('folds case, accents, punctuation and a leading "the"', () => {
    expect(brandKey('BIG W')).toBe(brandKey('big-w'));
    expect(brandKey('The Good Guys')).toBe('goodguys');
    expect(brandKey('Café & Co.')).toBe('cafeandco');
  });
});

describe('parsePartnerList', () => {
  it('splits lines, commas and bullets, drops list markers, blanks and duplicates', () => {
    const text = '1. Hoyts\n- Petstock\n• Event Cinemas, Taronga Zoo\n\nhoyts\n* Petstock';
    expect(parsePartnerList(text)).toEqual(['Hoyts', 'Petstock', 'Event Cinemas', 'Taronga Zoo']);
  });

  it('skips sentence-length lines', () => {
    expect(parsePartnerList(`Coles\n${'a very long marketing sentence '.repeat(3)}`)).toEqual(['Coles']);
  });

  it('newPartnerNames leaves out stores the scheme already has', () => {
    const existing = [buildRewardPartner({ id: 'x', groupId: G, schemeId: 's', name: 'Coles' })];
    expect(newPartnerNames(['coles', 'Kmart', 'KMART'], existing)).toEqual(['Kmart']);
  });
});

describe('perk labels', () => {
  it('formats each kind', () => {
    expect(perkValueLabel({ kind: 'percent', value: 10 }, '$')).toBe('10% off');
    expect(perkValueLabel({ kind: 'amount', value: 13.5 }, '$')).toBe('$13.50 off');
    expect(perkValueLabel({ kind: 'points', value: 2 }, '$')).toBe('2x points');
    expect(perkValueLabel({ kind: 'points', value: null }, '$')).toBe('Points');
    expect(perkValueLabel({ kind: 'other', value: 3 }, '$')).toBeNull();
  });

  it('captions endings within a month only', () => {
    expect(perkEndsCaption('2026-11-02', TODAY)).toBe('12d left');
    expect(perkEndsCaption(TODAY, TODAY)).toBe('ends today');
    expect(perkEndsCaption('2027-03-01', TODAY)).toBeNull();
    expect(perkEndsCaption('2026-10-01', TODAY)).toBe('ended');
  });

  it('lists live perks ending soon, soonest first', () => {
    expect(perksEndingSoon(fixture().perks, TODAY).map((p) => p.id)).toEqual(['work-ow']);
  });

  it('captions card expiry', () => {
    expect(cardExpiryCaption('2026-11-02', TODAY)).toBe('expires in 12d');
    expect(cardExpiryCaption('2027-01-20', TODAY)).toBe('renews in 3 mo');
    expect(cardExpiryCaption('2026-10-20', TODAY)).toBe('expired');
    expect(cardExpiryCaption('2028-01-01', TODAY)).toBeNull();
    expect(cardExpiryCaption(null, TODAY)).toBeNull();
  });
});

describe('cardsForStore', () => {
  it('finds every scheme that works at a store, best perk first', () => {
    const matches = cardsForStore('offi', fixture(), TODAY);
    expect(matches.map((m) => m.scheme.name)).toEqual(['Auto club', 'Work perks', 'Flybuys']);
    expect(matches[0].best?.id).toBe('club-ow');
    // The expired 50% perk doesn't count.
    expect(matches[1].perks.map((p) => p.id)).toEqual(['work-ow']);
    // Scheme-wide perks apply at every partner.
    expect(matches[2].best?.id).toBe('fly-points');
    expect(matches[2].cards.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(matchedStoreName('offi', matches)).toBe('Officeworks');
  });

  it('matches later words and, from four letters, inside a name', () => {
    expect(cardsForStore('liquor', fixture(), TODAY).map((m) => m.scheme.name)).toEqual(['Flybuys']);
    expect(cardsForStore('works', fixture(), TODAY)).toHaveLength(3);
    expect(cardsForStore('ork', fixture(), TODAY)).toHaveLength(0);
  });

  it("finds a scheme by its own name with all of the scheme's perks", () => {
    const [m] = cardsForStore('auto', fixture(), TODAY);
    expect(m.scheme.name).toBe('Auto club');
    expect(m.partners).toEqual([]);
    expect(m.perks.map((p) => p.id)).toEqual(['club-ow', 'club-hoyts']);
  });

  it('needs two characters and skips deleted rows', () => {
    const data = fixture();
    expect(cardsForStore('o', data, TODAY)).toEqual([]);
    data.partners = data.partners.map((p) => (p.id === 'p4' ? { ...p, deleted: true } : p));
    expect(cardsForStore('hoyts', data, TODAY)).toEqual([]);
  });

  it('names the query when matches span several stores', () => {
    const data = fixture();
    expect(matchedStoreName('co', cardsForStore('co', data, TODAY))).toBe('Coles');
  });
});

describe('summaries', () => {
  it('counts distinct stores and offers the most shared ones', () => {
    const { partners } = fixture();
    expect(storeCount(partners)).toBe(4);
    expect(storeCount(partners, new Set(['s-club']))).toBe(2);
    expect(popularStores(partners, 2)).toEqual(['Officeworks', 'Coles']);
  });

  it('gives a scheme its own colour or a stable one from its name', () => {
    expect(cardFaceColor({ name: 'X', color: '#112233' })).toBe('#112233');
    expect(cardFaceColor({ name: 'Flybuys', color: null })).toBe(cardFaceColor({ name: 'Flybuys', color: 'bad' }));
  });

  it('offers the starter list for the household currency', () => {
    expect(rewardCatalogFor('AUD').map((e) => e.name)).toContain('Flybuys');
    expect(rewardCatalogFor('EUR')).toEqual([]);
    expect(searchRewardCatalog(rewardCatalogFor('AUD'), 'every').map((e) => e.id)).toEqual(['au-everyday-rewards']);
  });
});
