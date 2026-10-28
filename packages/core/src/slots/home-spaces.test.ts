import { describe, expect, it } from 'vitest';
import { ALL_MANIFESTS } from '../module-manifests';
import { HOME_LENS_META } from '../home-lens';
import { HERO_MODULES } from '../home/hero-modules';
import { HOME_SPACES, homeSpaces } from './home-spaces';

const allOn = () => true;

describe('Home Spaces', () => {
  it('lists every Space once, in module order', () => {
    expect(HOME_SPACES.map((s) => s.key)).toEqual(['groceries', 'budget', 'bills', 'setup', 'search', 'shopper', 'assistant']);
    expect(new Set(HOME_SPACES.map((s) => s.key)).size).toBe(HOME_SPACES.length);
  });

  it("points each lens at its own section and each setting at a Customize switch", () => {
    const settings = new Set(HERO_MODULES.filter((m) => m.group === 'spaces').map((m) => m.key));
    for (const space of HOME_SPACES) {
      if (space.lens) expect(HOME_LENS_META[space.lens].sectionId).toBe(space.moduleId);
      if (space.setting) expect(settings).toContain(space.setting);
      expect(ALL_MANIFESTS.find((m) => m.id === space.moduleId)?.section).toBeDefined();
    }
  });

  it('shows every Space on the dashboard', () => {
    const spaces = homeSpaces({ hidden: [], settingOn: allOn, lens: null });
    expect(spaces.every((s) => s.shown && !s.expanded)).toBe(true);
  });

  // The on/off check: hiding or switching off a module (hidden covers both) drops only its Spaces.
  it.each(HOME_SPACES.map((s) => s.moduleId).filter((id, i, all) => all.indexOf(id) === i))('drops only %s when it is hidden', (moduleId) => {
    const all = homeSpaces({ hidden: [], settingOn: allOn, lens: null }).map((s) => s.space.key);
    const left = homeSpaces({ hidden: [moduleId], settingOn: allOn, lens: null }).map((s) => s.space.key);
    expect(left).toEqual(all.filter((key) => HOME_SPACES.find((s) => s.key === key)!.moduleId !== moduleId));
  });

  it('keeps a Space its setting turns off mounted but not shown', () => {
    const spaces = homeSpaces({ hidden: [], settingOn: (key) => key !== 'spaceBills', lens: null });
    expect(spaces.find((s) => s.space.key === 'bills')).toMatchObject({ shown: false, expanded: false });
    expect(spaces.find((s) => s.space.key === 'budget')).toMatchObject({ shown: true });
  });

  it('shows only the Space a shortcut filters to, expanded, even with its setting off', () => {
    const spaces = homeSpaces({ hidden: [], settingOn: () => false, lens: 'billsDue' });
    expect(spaces.filter((s) => s.shown).map((s) => [s.space.key, s.expanded])).toEqual([['bills', true]]);
  });
});
