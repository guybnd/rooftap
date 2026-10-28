// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_MANIFESTS } from '../module-manifests';
import { MODULE_FEATURES } from '../module-features';
import { resetModulesStore, setModuleRows } from '../modules-store';
import { ALL_MODULE_IDS, type GroupModuleRow } from '../modules';
import { heroItemOpenTarget, heroItemSectionId } from '../feed';
import type { HeroItem } from '../hero';
import { HOME_AGENDA_SOURCES, useHomeAgenda } from './home';
import type { HomeAgendaSource } from './types';

function rows(off: string[]): GroupModuleRow[] {
  return ALL_MODULE_IDS.map((module_id) => ({ module_id, enabled: !off.includes(module_id) }) as GroupModuleRow);
}

function item(moduleId: string, completable = true): HeroItem {
  return {
    id: `${moduleId}-1`,
    type: 'module',
    ownerSection: moduleId,
    title: moduleId,
    dueDate: '2026-10-28',
    dueTime: null,
    overdue: false,
    done: false,
    assignedTo: null,
    sourceLabel: '',
    module: { id: moduleId, href: `/${moduleId}`, completable },
  };
}

/** A fake source with one item, recording the group id it was handed and its finishes. */
function fakeSource(moduleId: string, feature: HomeAgendaSource['feature'], seen: (string | undefined)[], complete = vi.fn(), undo = vi.fn()): HomeAgendaSource {
  const items = [item(moduleId)];
  const part = { items, complete, undo };
  return {
    moduleId,
    feature,
    useAgenda({ groupId }) {
      seen.push(groupId);
      return part;
    },
  };
}

afterEach(() => resetModulesStore());

describe('Home agenda slot registry', () => {
  it("has one source for each module whose manifest lists the home-agenda slot, and nothing else", () => {
    const declared = ALL_MANIFESTS.filter((m) => m.slots?.includes('home-agenda')).map((m) => m.id).sort();
    expect(HOME_AGENDA_SOURCES.map((s) => s.moduleId).sort()).toEqual(declared);
  });

  it('gates every source on a hub feature that needs the module', () => {
    for (const source of HOME_AGENDA_SOURCES) {
      expect(source.feature.startsWith('hub.')).toBe(true);
      expect(MODULE_FEATURES[source.feature].modules as readonly string[]).toContain(source.moduleId);
    }
  });
});

describe('useHomeAgenda', () => {
  it('merges switched-on sources and routes finish and undo to the module an item came from', () => {
    setModuleRows(rows([]));
    const seen: (string | undefined)[] = [];
    const binsComplete = vi.fn();
    const binsUndo = vi.fn();
    const sources = [fakeSource('bins', 'hub.bins', seen, binsComplete, binsUndo), fakeSource('setup', 'hub.setup-progress', seen)];
    const { result } = renderHook(() => useHomeAgenda('g', 'me', [], sources));
    expect(result.current.items.map((i) => i.id)).toEqual(['bins-1', 'setup-1']);
    expect(seen).toEqual(['g', 'g']);
    const bins = result.current.items[0];
    expect(result.current.canComplete(bins)).toBe(true);
    act(() => result.current.complete(bins));
    act(() => result.current.undo(bins));
    expect(binsComplete).toHaveBeenCalledWith(bins);
    expect(binsUndo).toHaveBeenCalledWith(bins);
  });

  // The on/off check: switch the module off, or hide its section, and only its items go.
  it.each([
    ['switched off', ['bins'], []],
    ['hidden', [], ['bins']],
  ])('drops a module that is %s and opens its stores inert', (_why, off, hidden) => {
    setModuleRows(rows(off));
    const seen: (string | undefined)[] = [];
    const sources = [fakeSource('bins', 'hub.bins', seen), fakeSource('setup', 'hub.setup-progress', seen)];
    const { result } = renderHook(() => useHomeAgenda('g', 'me', hidden, sources));
    expect(result.current.items.map((i) => i.id)).toEqual(['setup-1']);
    expect(seen).toEqual([undefined, 'g']);
    expect(result.current.canComplete(item('bins'))).toBe(false);
  });

  it('does not finish an item its module marks not completable', () => {
    setModuleRows(rows([]));
    const { result } = renderHook(() => useHomeAgenda('g', 'me', [], [fakeSource('bins', 'hub.bins', [])]));
    expect(result.current.canComplete(item('bins', false))).toBe(false);
  });
});

describe('module feed items', () => {
  it("wear their module's tile and open its screen", () => {
    expect(heroItemSectionId(item('bins'))).toBe('bins');
    expect(heroItemOpenTarget(item('bins'))).toEqual({ kind: 'route', href: '/bins' });
  });
});
