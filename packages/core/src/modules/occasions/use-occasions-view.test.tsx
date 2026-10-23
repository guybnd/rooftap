// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildGiftIdea, buildOccasion, buildWishlistItem, type MemberProfileMap, type Occasion } from './occasions';
import type { OccasionsApi } from './use-occasions';
import { useIdeaForm, useOccasionForm, useOccasionsScreen, useWishForm } from './use-occasions-view';

const ME = 'u-me';
const TEGAN = 'u-tegan';
const profiles: MemberProfileMap = { [TEGAN]: { email: 't@x.com', name: 'Tegan', avatar: null } };
const TODAY = '2026-10-23';

const tegan = buildOccasion({ id: 'o1', groupId: 'g', title: "Tegan's birthday", kind: 'birthday', date: '1990-10-25', personId: TEGAN, createdBy: ME });
const xmas = buildOccasion({ id: 'o2', groupId: 'g', title: 'Christmas', kind: 'holiday', date: '2026-12-25', createdBy: ME });

function screenApi(occasions: Occasion[]): OccasionsApi {
  return {
    today: TODAY,
    occasions,
    occasionById: new Map(occasions.map((o) => [o.id, o])),
    ideas: [],
    wishlist: [buildWishlistItem({ id: 'w1', groupId: 'g', userId: ME, title: 'Shoes' }), buildWishlistItem({ id: 'w2', groupId: 'g', userId: TEGAN, title: 'Robe' })],
  } as unknown as OccasionsApi;
}

describe('useOccasionsScreen', () => {
  it('focuses the next occasion until another is picked', () => {
    const { result } = renderHook(() => useOccasionsScreen(screenApi([tegan, xmas]), ME));
    expect(result.current.focus?.id).toBe('o1');
    expect(result.current.mine.map((w) => w.id)).toEqual(['w1']);
    expect(result.current.othersLists.map(([u]) => u)).toEqual([TEGAN]);
    expect(result.current.lede.value).toBe(2);
    expect(result.current.empty).toBe(false);
    act(() => result.current.setFocusId('o2'));
    expect(result.current.focus?.id).toBe('o2');
  });
});

describe('useOccasionForm', () => {
  const setup = (extra: Partial<Parameters<typeof useOccasionForm>[0]> = {}) => {
    const api = { saveOccasion: vi.fn() };
    const hook = renderHook(() => useOccasionForm({ api, groupId: 'g', currentUserId: ME, profiles, calendar: false, initialDate: '', ...extra }));
    return { api, ...hook };
  };

  it('suggests a title from the person and refuses a missing day', () => {
    const { api, result } = setup();
    act(() => result.current.setWho({ kind: 'member', id: TEGAN }));
    expect(result.current.shownTitle).toBe("Tegan's birthday");
    let saved: Occasion | null = null;
    act(() => {
      saved = result.current.submit();
    });
    expect(saved).toBeNull();
    expect(result.current.tried).toBe(true);
    expect(api.saveOccasion).not.toHaveBeenCalled();
  });

  it('saves a new occasion, never kept from yourself, with the Calendar switch only when offered', () => {
    const { api, result } = setup({ initialDate: TODAY });
    act(() => {
      result.current.setWho({ kind: 'member', id: TEGAN });
      result.current.setBudget('40');
      result.current.keepFrom(TEGAN, true);
      result.current.keepFrom(ME, true);
    });
    let saved: Occasion | null = null;
    act(() => {
      saved = result.current.submit();
    });
    expect(saved).toMatchObject({ title: "Tegan's birthday", date: TODAY, person_id: TEGAN, budget_cents: 4000, hidden_from: [TEGAN] });
    expect(saved).not.toHaveProperty('on_calendar');
    expect(api.saveOccasion).toHaveBeenCalledWith(saved);
  });

  it('keeps a typed title and writes on_calendar when offered', () => {
    const { result } = setup({ occasion: xmas, calendar: true });
    act(() => {
      result.current.typeTitle('Xmas');
      result.current.setOnCalendar(false);
    });
    let saved: Occasion | null = null;
    act(() => {
      saved = result.current.submit();
    });
    expect(saved).toMatchObject({ id: 'o2', title: 'Xmas', person_id: null, person_name: null, on_calendar: false });
  });
});

describe('useIdeaForm', () => {
  const setup = (extra: Partial<Parameters<typeof useIdeaForm>[0]> = {}) => {
    const api = {
      occasionById: new Map([tegan, xmas].map((o) => [o.id, o])),
      today: TODAY,
      linkedCostOf: () => null,
      linkedWantOf: () => null,
      saveIdea: vi.fn(),
    } as unknown as Parameters<typeof useIdeaForm>[0]['api'];
    const hook = renderHook(() =>
      useIdeaForm({ occasion: tegan, api, groupId: 'g', currentUserId: ME, memberIds: [ME, TEGAN], profiles, features: { costs: true, shopper: true }, ...extra }),
    );
    return { api, ...hook };
  };

  it('keeps a new idea from the person it is for, until a switch is touched', () => {
    const { result } = setup();
    expect(result.current.forUserId).toBe(TEGAN);
    expect(result.current.hidden).toEqual([TEGAN]);
    expect(result.current.hints.length).toBeGreaterThan(0);
    act(() => result.current.pickFor(null));
    expect(result.current.hidden).toEqual([]);
    act(() => result.current.keepFrom(TEGAN, true));
    act(() => result.current.pickFor(TEGAN));
    act(() => result.current.pickFor(null));
    expect(result.current.hidden).toEqual([TEGAN]);
  });

  it('picks the occasion person for a new idea', () => {
    const { result } = setup({ occasion: null });
    expect(result.current.forUserId).toBeNull();
    act(() => result.current.pickOccasion(tegan));
    expect(result.current.occasionId).toBe('o1');
    expect(result.current.forUserId).toBe(TEGAN);
  });

  it('refuses an unnamed idea and saves a named one with its options', () => {
    const { api, result } = setup();
    let ok = true;
    act(() => {
      ok = result.current.submit();
    });
    expect(ok).toBe(false);
    act(() => {
      result.current.setTitle('Robe');
      result.current.setPrice('89');
      result.current.setInBudget(true);
    });
    act(() => {
      ok = result.current.submit();
    });
    expect(ok).toBe(true);
    expect(api.saveIdea).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Robe', occasion_id: 'o1', for_user_id: TEGAN, price_cents: 8900, hidden_from: [TEGAN] }),
      { inBudget: true, watch: false },
    );
  });

  it('edits an existing idea in place', () => {
    const idea = buildGiftIdea({ id: 'i1', groupId: 'g', title: 'Robe', occasionId: 'o1', forUserId: TEGAN, hiddenFrom: [], createdBy: ME });
    const { api, result } = setup({ idea });
    expect(result.current.hidden).toEqual([]);
    act(() => result.current.setStatus('bought'));
    act(() => {
      result.current.submit();
    });
    expect(api.saveIdea).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1', status: 'bought' }), { inBudget: false, watch: false });
  });
});

describe('useWishForm', () => {
  it('saves a trimmed wish and refuses an empty one', () => {
    const api = { saveWish: vi.fn() };
    const { result } = renderHook(() => useWishForm({ api, groupId: 'g', currentUserId: ME }));
    let ok = true;
    act(() => {
      ok = result.current.submit();
    });
    expect(ok).toBe(false);
    act(() => {
      result.current.setTitle(' Shoes ');
      result.current.setUrl(' ');
      result.current.setPrice('120');
    });
    act(() => {
      ok = result.current.submit();
    });
    expect(ok).toBe(true);
    expect(api.saveWish).toHaveBeenCalledWith(expect.objectContaining({ title: 'Shoes', url: null, price_cents: 12000, user_id: ME }));
  });
});
