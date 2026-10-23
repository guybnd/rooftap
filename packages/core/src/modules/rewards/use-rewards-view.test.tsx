// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LoyaltyCard } from '../../types';
import { buildRewardPartner, buildRewardScheme, type RewardScheme } from './rewards';
import type { RewardsApi } from './use-rewards';
import { useCardForm, usePerkForm, useRewardsScreen, useSchemeForm } from './use-rewards-view';

const G = 'g1';

function card(id: string, schemeId: string | null, extra: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return {
    id,
    group_id: G,
    created_by: 'u1',
    name: 'Gym',
    number: '12345678',
    format: 'code128',
    scheme_id: schemeId,
    private: false,
    created_at: 'x',
    updated_at: 'x',
    deleted: false,
    ...extra,
  };
}

/** A RewardsApi over plain arrays, with every write a spy. */
function fakeRewards(over: Partial<RewardsApi> = {}): RewardsApi {
  const schemes: RewardScheme[] = over.schemes ?? [];
  return {
    loaded: true,
    schemes,
    partners: [],
    perks: [],
    cards: [],
    schemeOf: (c) => (c?.scheme_id ? schemes.find((s) => s.id === c.scheme_id) ?? null : null),
    addScheme: vi.fn(() => 'new-scheme'),
    saveScheme: vi.fn(),
    deleteScheme: vi.fn(),
    addPartners: vi.fn(),
    removePartner: vi.fn(),
    savePerk: vi.fn(),
    removePerk: vi.fn(),
    saveCard: vi.fn(),
    deleteCard: vi.fn(),
    ...over,
  };
}

describe('useRewardsScreen', () => {
  it('gives an old card a scheme named after it before editing its stores', () => {
    const rewards = fakeRewards();
    const { result } = renderHook(() => useRewardsScreen(rewards, 'u1'));
    const old = card('c1', null);
    expect(result.current.storesSchemeFor(old)).toBe('new-scheme');
    expect(rewards.addScheme).toHaveBeenCalledWith({ name: 'Gym' });
    expect(rewards.saveCard).toHaveBeenCalledWith({ ...old, scheme_id: 'new-scheme' });
  });

  it('uses the scheme a card already has', () => {
    const fly = buildRewardScheme({ id: 's-fly', groupId: G, name: 'Flybuys' });
    const rewards = fakeRewards({ schemes: [fly] });
    const { result } = renderHook(() => useRewardsScreen(rewards, 'u1'));
    expect(result.current.storesSchemeFor(card('c1', 's-fly'))).toBe('s-fly');
    expect(rewards.addScheme).not.toHaveBeenCalled();
  });

  it('searches from two letters on the Cards tab', () => {
    const { result } = renderHook(() => useRewardsScreen(fakeRewards(), 'u1'));
    act(() => result.current.setQuery('c'));
    expect(result.current.searching).toBe(false);
    act(() => result.current.setQuery('co'));
    expect(result.current.searching).toBe(true);
    act(() => result.current.setTab('perks'));
    expect(result.current.searching).toBe(false);
  });
});

describe('useCardForm', () => {
  it('needs a name and a valid number before saving', () => {
    const rewards = fakeRewards();
    const onSaved = vi.fn();
    const { result } = renderHook(() => useCardForm({ rewards, groupId: G, currentUserId: 'u1', onSaved }));
    act(() => result.current.submit());
    expect(result.current.nameError).toBe('Name the card');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves into an existing scheme by name', () => {
    const fly = buildRewardScheme({ id: 's-fly', groupId: G, name: 'Flybuys' });
    const rewards = fakeRewards({ schemes: [fly] });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useCardForm({ rewards, groupId: G, currentUserId: 'u1', onSaved }));
    act(() => {
      result.current.typeSchemeName('flybuys');
      result.current.setNumber('6008 1234 5678');
      result.current.setVisibility('private');
    });
    act(() => result.current.submit());
    expect(rewards.addScheme).not.toHaveBeenCalled();
    const saved = onSaved.mock.calls[0][0] as LoyaltyCard;
    expect(saved).toMatchObject({ name: 'Flybuys', number: '600812345678', scheme_id: 's-fly', private: true, group_id: G });
    expect(rewards.saveCard).toHaveBeenCalledWith(saved);
  });

  it('keeps a card shared when someone else added it', () => {
    const rewards = fakeRewards();
    const theirs = card('c1', null, { created_by: 'u2', private: false });
    const { result } = renderHook(() => useCardForm({ card: theirs, rewards, groupId: G, currentUserId: 'u1', onSaved: vi.fn() }));
    expect(result.current.canMakePrivate).toBe(false);
    expect(result.current.visibilityOptions.map((v) => v.value)).toEqual(['shared']);
  });
});

describe('useSchemeForm', () => {
  it('adds pasted stores that are new, then closes the paste box', () => {
    const fly = buildRewardScheme({ id: 's-fly', groupId: G, name: 'Flybuys' });
    const coles = buildRewardPartner({ id: 'p1', groupId: G, schemeId: 's-fly', name: 'Coles' });
    const rewards = fakeRewards({ schemes: [fly], partners: [coles] });
    const { result } = renderHook(() => useSchemeForm({ scheme: fly, rewards, groupId: G }));
    act(() => {
      result.current.setPasting(true);
      result.current.setPasted('Coles\nKmart\nTarget');
    });
    expect(result.current.pastedNames).toEqual(['Kmart', 'Target']);
    act(() => result.current.addPasted());
    expect(rewards.addPartners).toHaveBeenCalledWith('s-fly', ['Kmart', 'Target']);
    expect(result.current.pasting).toBe(false);
    expect(result.current.pasted).toBe('');
  });

  it('keeps the old name when the field is blank', () => {
    const fly = buildRewardScheme({ id: 's-fly', groupId: G, name: 'Flybuys' });
    const rewards = fakeRewards({ schemes: [fly] });
    const { result } = renderHook(() => useSchemeForm({ scheme: fly, rewards, groupId: G }));
    act(() => {
      result.current.setName('  ');
      result.current.setWebsite('');
    });
    act(() => result.current.save());
    expect(rewards.saveScheme).toHaveBeenCalledWith({ ...fly, name: 'Flybuys', website: null });
  });
});

describe('usePerkForm', () => {
  it('adds the perk with a made-up title, then resets and closes', () => {
    const onAdd = vi.fn();
    const { result } = renderHook(() => usePerkForm([{ id: 'p1', name: 'Coles' }], onAdd));
    act(() => {
      result.current.setOpen(true);
      result.current.setValue('10');
      result.current.setPartnerId('p1');
    });
    expect(result.current.finalTitle).toBe('10% off at Coles');
    act(() => result.current.add());
    expect(onAdd).toHaveBeenCalledWith({
      partnerId: 'p1',
      title: '10% off at Coles',
      kind: 'percent',
      value: 10,
      conditions: null,
      validUntil: null,
    });
    expect(result.current.open).toBe(false);
    expect(result.current.value).toBe('');
  });
});
