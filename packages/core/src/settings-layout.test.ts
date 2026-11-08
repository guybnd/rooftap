import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS, settingsTabForKey, settingsTabHref } from './settings-layout';
import { getSection } from './sections';

describe('settings tabs', () => {
  it('opens each tab by its own id', () => {
    for (const t of SETTINGS_TABS) expect(settingsTabForKey(t.id)).toBe(t.id);
  });

  it('sends the old menu keys to their new tab', () => {
    expect(settingsTabForKey('global')).toBe('you');
    expect(settingsTabForKey('users')).toBe('house');
    expect(settingsTabForKey('modules')).toBe('tiles');
    expect(settingsTabForKey('integrations')).toBe('connected');
    expect(settingsTabForKey('whats-new')).toBe('about');
  });

  it('leaves module keys to the module settings page', () => {
    expect(settingsTabForKey('costs')).toBeNull();
    expect(settingsTabForKey(undefined)).toBeNull();
  });

  it('never shadows a section id', () => {
    for (const t of SETTINGS_TABS) expect(getSection(t.id), t.id).toBeUndefined();
  });

  it('puts You at the plain path', () => {
    expect(settingsTabHref('you')).toBe('/settings');
    expect(settingsTabHref('about')).toBe('/settings/about');
  });
});
