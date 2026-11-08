import { describe, expect, it } from 'vitest';
import { MODULES } from './modules';
import { sections } from './sections';
import { ALL_MANIFESTS } from './module-manifests';
import { MODULE_SETTINGS, hasModuleSettings, moduleSettingsPanels, moduleSettingsTabs, moduleSettingsTitle } from './module-settings';

describe('module settings', () => {
  it('lists settings only for modules with a section', () => {
    const ids = new Set(MODULES.map((m) => m.id));
    for (const id of Object.keys(MODULE_SETTINGS)) {
      expect(ids.has(id as never), id).toBe(true);
      expect(sections.some((s) => s.id === id), `${id} has a screen to open them from`).toBe(true);
    }
  });

  it('names each panel once', () => {
    const all = Object.values(MODULE_SETTINGS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('shows a panel owned by another module only while that module is on', () => {
    expect(moduleSettingsPanels('calendar', new Set(['calendar']))).toEqual([]);
    expect(moduleSettingsPanels('calendar', new Set(['calendar', 'google-calendar']))).toEqual(['google-calendar']);
    expect(hasModuleSettings('calendar', new Set(['calendar']))).toBe(false);
  });

  it('keeps the Costs panels in order', () => {
    expect(moduleSettingsPanels('costs', new Set(['costs']))).toEqual(['costs-goal', 'costs-recent', 'costs-subscriptions', 'costs-summaries']);
    expect(moduleSettingsPanels('recipes', new Set(['recipes']))).toEqual([]);
  });

  it('puts every panel in exactly one tab, in the settings order', () => {
    for (const m of ALL_MANIFESTS) {
      if (!m.settingsTabs) continue;
      expect(m.settingsTabs.flatMap((t) => t.panels), m.id).toEqual(m.settings);
      for (const t of m.settingsTabs) expect(t.label.trim().length, `${m.id} tab label`).toBeGreaterThan(0);
    }
  });

  it('gives a module with no tabs one unlabelled tab', () => {
    expect(moduleSettingsTabs('costs', new Set(['costs']))).toEqual([
      { label: '', panels: ['costs-goal', 'costs-recent', 'costs-subscriptions', 'costs-summaries'] },
    ]);
    expect(moduleSettingsTabs('recipes', new Set(['recipes']))).toEqual([]);
  });

  it('splits the Assistant settings into tabs', () => {
    expect(moduleSettingsTabs('assistant', new Set(['assistant'])).map((t) => t.label)).toEqual([
      'General',
      'Helpers',
      'Memories',
      'Spending',
      'Connections',
    ]);
  });

  it('titles the row and the sheet', () => {
    expect(moduleSettingsTitle('Costs')).toBe('Costs settings');
  });
});
