import { describe, expect, it } from 'vitest';
import type { LoyaltyCard } from '../../types';
import { buildRewardPartner, buildRewardPerk, buildRewardScheme, cardsForStore, type RewardCatalogEntry } from './rewards';
import {
  cardHolderLabel,
  cardSchemeSuggestions,
  knownStoreNames,
  perkDraftTitle,
  perkDraftValue,
  perkListGroups,
  perkRowMeta,
  perkValueField,
  rewardsLede,
  schemePerkMeta,
  storeMatchTarget,
  storeNameSuggestions,
  walletCardDetail,
} from './rewards-view';

const G = 'g1';
const TODAY = '2026-10-21';

function card(id: string, schemeId: string | null, extra: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return {
    id,
    group_id: G,
    created_by: 'u1',
    name: 'Card',
    number: `60080000${id}`,
    format: 'code128',
    scheme_id: schemeId,
    private: false,
    created_at: 'x',
    updated_at: 'x',
    deleted: false,
    ...extra,
  };
}

const fly = buildRewardScheme({ id: 's-fly', groupId: G, name: 'Flybuys' });
const club = buildRewardScheme({ id: 's-club', groupId: G, name: 'Auto club' });
const partners = [
  buildRewardPartner({ id: 'p1', groupId: G, schemeId: 's-fly', name: 'Coles' }),
  buildRewardPartner({ id: 'p2', groupId: G, schemeId: 's-fly', name: 'Officeworks' }),
  buildRewardPartner({ id: 'p3', groupId: G, schemeId: 's-club', name: 'Officeworks' }),
];
const perk = (id: string, schemeId: string, partnerId: string | null, value: number, extra: { conditions?: string; validUntil?: string } = {}) =>
  buildRewardPerk({ id, groupId: G, schemeId, partnerId, title: id, kind: 'percent', value, ...extra });

describe('rewardsLede', () => {
  const base = { searching: false, query: '', matches: [], livePerks: [], ending: [], schemes: [fly, club], cards: [], partners };

  it('counts cards and the stores they work at', () => {
    expect(rewardsLede({ ...base, tab: 'cards', cards: [card('c1', 's-fly')] })).toEqual({
      value: 1,
      label: 'card',
      caption: 'works at 2 stores',
    });
    expect(rewardsLede({ ...base, tab: 'cards', partners: [] }).caption).toBe('Add the stores each card works at');
  });

  it('answers the store search', () => {
    const data = { schemes: [fly, club], partners, perks: [], cards: [card('c1', 's-fly')] };
    const matches = cardsForStore('officeworks', data, TODAY);
    const lede = rewardsLede({ ...base, tab: 'cards', searching: true, query: 'officeworks', matches });
    expect(lede.value).toBe(2);
    expect(lede.label).toBe('work at Officeworks');
    expect(lede.caption).toBe('1 with a card');
    expect(rewardsLede({ ...base, tab: 'cards', searching: true, query: 'aldi', matches: [] }).caption).toBe('Nothing listed there yet');
  });

  it('counts live perks on the Perks tab', () => {
    const p = perk('a', 's-fly', null, 5);
    expect(rewardsLede({ ...base, tab: 'perks', livePerks: [p], ending: [p] })).toEqual({ value: 1, label: 'perk', caption: '1 ending this month' });
    expect(rewardsLede({ ...base, tab: 'perks', livePerks: [p, p] }).caption).toBe('across 2 schemes');
  });
});

describe('wallet helpers', () => {
  it('names who sees a card', () => {
    expect(cardHolderLabel({ private: true })).toBe('Just me');
    expect(cardHolderLabel({ private: false })).toBe('Shared');
  });

  it('builds the face detail from stores and expiry', () => {
    expect(walletCardDetail(card('c1', 's-fly'), fly, partners, TODAY)).toBe('2 stores');
    expect(walletCardDetail(card('c1', null), null, partners, TODAY)).toBe('');
    expect(walletCardDetail(card('c1', 's-club', { expires_on: '2026-10-01' }), club, partners, TODAY)).toMatch(/^1 store · /);
  });

  it('opens the viewer’s own card for a match, else any card, else the scheme', () => {
    const match = { scheme: fly, best: null, partners: [], perks: [], cards: [card('c1', 's-fly', { created_by: 'u2' }), card('c2', 's-fly', { created_by: 'u1' })] };
    expect(storeMatchTarget(match, 'u1')).toEqual({ kind: 'card', id: 'c2' });
    expect(storeMatchTarget(match, 'u9')).toEqual({ kind: 'card', id: 'c1' });
    expect(storeMatchTarget({ ...match, cards: [] }, 'u1')).toEqual({ kind: 'scheme', id: 's-fly' });
  });
});

describe('perk lists', () => {
  it('groups perks by scheme name, leaving out the ending ones', () => {
    const a = perk('a', 's-fly', null, 5);
    const b = perk('b', 's-club', 'p3', 10);
    const c = perk('c', 's-club', null, 20);
    const groups = perkListGroups([a, b, c], [a], [fly, club]);
    expect(groups.map((g) => g.scheme.id)).toEqual(['s-club']);
    expect(groups[0].perks.map((p) => p.id)).toEqual(['c', 'b']);
  });

  it('writes row metas', () => {
    const p = perk('a', 's-club', 'p3', 5, { conditions: 'Show card' });
    const schemeName = new Map([['s-club', 'Auto club']]);
    const partnerName = new Map([['p3', 'Officeworks']]);
    expect(perkRowMeta(p, { showScheme: true, schemeName, partnerName })).toBe('Auto club · Officeworks · Show card');
    expect(perkRowMeta(perk('b', 's-fly', null, 5), { showScheme: false, schemeName, partnerName })).toBe('Every store');
    expect(schemePerkMeta(p, partnerName, 'Ends in 3 days')).toBe('Officeworks · Show card · Ends in 3 days');
    expect(schemePerkMeta(perk('b', 's-fly', null, 5), partnerName, null)).toBe('Every store');
  });
});

describe('store suggestions', () => {
  const catalog: RewardCatalogEntry[] = [
    { id: 'x', region: 'AU', name: 'X', kind: 'loyalty', website: '', color: '', partners: [{ name: 'Coles' }, { name: 'Kmart' }] },
  ];

  it('knows the household’s stores, then the starter list’s', () => {
    expect(knownStoreNames(partners, catalog)).toEqual(['Coles', 'Officeworks', 'Kmart']);
  });

  it('suggests known names by prefix, minus the scheme’s own', () => {
    const known = ['Coles', 'Officeworks', 'Kmart', 'Costco'];
    expect(storeNameSuggestions('co', known, [partners[0]])).toEqual(['Costco']);
    expect(storeNameSuggestions('  ', known, [])).toEqual([]);
  });
});

describe('cardSchemeSuggestions', () => {
  const starters: RewardCatalogEntry[] = [
    { id: 'au-fly', region: 'AU', name: 'Flybuys', kind: 'loyalty', website: '', color: '', partners: [] },
    { id: 'au-ev', region: 'AU', name: 'Everyday Rewards', kind: 'loyalty', website: '', color: '', partners: [] },
  ];

  it('offers own schemes and starters the household lacks', () => {
    const s = cardSchemeSuggestions('', [fly], starters, null);
    expect(s.own.map((x) => x.id)).toEqual(['s-fly']);
    expect(s.starters.map((x) => x.id)).toEqual(['au-ev']);
  });

  it('hides once the name matches exactly, unless a starter was picked', () => {
    expect(cardSchemeSuggestions('Flybuys', [fly], starters, null)).toEqual({ own: [], starters: [] });
    expect(cardSchemeSuggestions('Everyday Rewards', [], starters, starters[1])).toEqual({ own: [], starters: [] });
    expect(cardSchemeSuggestions('Every', [], starters, starters[1]).starters).toEqual([]);
  });
});

describe('perk draft', () => {
  const stores = [{ id: 'p1', name: 'Coles' }];

  it('reads the typed value', () => {
    expect(perkDraftValue('10%')).toBe(10);
    expect(perkDraftValue('')).toBeNull();
    expect(perkDraftValue('0')).toBeNull();
  });

  it('makes a title when none was typed', () => {
    expect(perkDraftTitle({ title: '', kind: 'percent', value: '10', partnerId: null }, stores)).toBe('10% off');
    expect(perkDraftTitle({ title: '', kind: 'percent', value: '10', partnerId: 'p1' }, stores)).toBe('10% off at Coles');
    expect(perkDraftTitle({ title: '', kind: 'amount', value: '5', partnerId: null }, stores)).toBe('Money off');
    expect(perkDraftTitle({ title: '', kind: 'points', value: '', partnerId: null }, stores)).toBe('Points');
    expect(perkDraftTitle({ title: '', kind: 'other', value: '', partnerId: 'p1' }, stores)).toBe('at Coles');
    expect(perkDraftTitle({ title: ' Movies ', kind: 'other', value: '', partnerId: null }, stores)).toBe('Movies');
  });

  it('labels the value field by kind', () => {
    expect(perkValueField('percent')).toEqual({ label: 'Percent', placeholder: '10' });
    expect(perkValueField('amount')).toEqual({ label: 'Amount', placeholder: '5' });
    expect(perkValueField('points')).toEqual({ label: 'Times points', placeholder: '2' });
  });
});
