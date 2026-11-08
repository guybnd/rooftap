// The app Settings screen's tabs (HOUP-616). Settings opens on these five
// tabs, with no hub page first. Each app's settings-registry lists the panels
// of each tab (component refs stay app-level); this file holds the ids, the
// labels and the old menu keys that still open the right tab, so links such
// as /settings/integrations keep working on both platforms.

export type SettingsTabId = 'you' | 'house' | 'tiles' | 'connected' | 'about';

export interface SettingsTabMeta {
  id: SettingsTabId;
  label: string;
}

export const SETTINGS_TABS: readonly SettingsTabMeta[] = [
  { id: 'you', label: 'You' },
  { id: 'house', label: 'Home' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'connected', label: 'Connected' },
  { id: 'about', label: 'About' },
];

/** The menu keys Settings had before its tabs, and the tab each now opens. */
const LEGACY_MENU_TABS: Readonly<Record<string, SettingsTabId>> = {
  global: 'you',
  appearance: 'you',
  notifications: 'you',
  users: 'house',
  modules: 'tiles',
  connectors: 'connected',
  integrations: 'connected',
  server: 'connected',
  'whats-new': 'about',
};

/** The tab a /settings/<key> link opens: a tab id or an old menu key. Anything else (a module's settings) is null. */
export function settingsTabForKey(key: string | null | undefined): SettingsTabId | null {
  if (!key) return null;
  if (SETTINGS_TABS.some((t) => t.id === key)) return key as SettingsTabId;
  return LEGACY_MENU_TABS[key] ?? null;
}

/** The path of a Settings tab. You is the plain /settings. */
export function settingsTabHref(id: SettingsTabId): string {
  return id === 'you' ? '/settings' : `/settings/${id}`;
}
