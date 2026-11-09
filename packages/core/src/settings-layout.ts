// The app Settings screen's tabs (HOUP-616). Settings opens on these five
// tabs, with no hub page first. Each app's settings-registry lists the panels
// of each tab (component refs stay app-level); this file holds the ids, the
// labels and the old menu keys that still open the right tab, so links such
// as /settings/integrations keep working on both platforms.
import type { NamedHue } from './section-hues';

export type SettingsTabId = 'you' | 'house' | 'tiles' | 'connected' | 'about';

export interface SettingsTabMeta {
  id: SettingsTabId;
  label: string;
}

export const SETTINGS_TABS: readonly SettingsTabMeta[] = [
  { id: 'you', label: 'You' },
  { id: 'house', label: 'Home' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'connected', label: 'Linked' },
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

/**
 * The hue of a settings panel's leading tile in the Settings tabs (Guy,
 * 2026-11-08: the tabs read drab, so each panel wears a colour). Keyed by
 * the panel's title; a title not listed here gets a steady hue from its
 * letters, so a new panel is never grey.
 */
const PANEL_HUES: Readonly<Record<string, NamedHue>> = {
  Appearance: 'rose',
  'Animation speed': 'sky',
  Haptics: 'mint',
  'Push notifications': 'coral',
  'What you get': 'sun',
  Navigation: 'indigo',
  'Section preferences': 'teal',
  'Bot API key': 'olive',
  'MCP server': 'lime',
  'Up Bank': 'peach',
  'Bank statement': 'sun',
  'Household AI keys': 'lilac',
  'AI providers': 'orchid',
  'API keys': 'olive',
  Feedback: 'cherry',
  Server: 'teal',
  'Home profile': 'fern',
  'Create a user': 'lilac',
  'Pending invitations': 'coral',
  Tiles: 'orchid',
  Version: 'sky',
  Updates: 'sky',
  "What's new": 'mint',
};

const FALLBACK_HUES: readonly NamedHue[] = ['coral', 'lilac', 'mint', 'sun', 'sky', 'peach', 'rose', 'teal', 'lime', 'orchid', 'fern', 'indigo'];

export function settingsPanelHue(title: string): NamedHue {
  const listed = PANEL_HUES[title];
  if (listed) return listed;
  let sum = 0;
  for (const ch of title) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_HUES[sum % FALLBACK_HUES.length];
}
