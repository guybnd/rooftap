// HOUP-616: Settings opens on its tabs (features/settings/settings-home.tsx).
// The old hub of menu rows is gone; /settings/<old menu key> still opens the
// matching tab (core settingsTabForKey).
import * as React from 'react';
import { SettingsHome } from '@/features/settings/settings-home';

export default function SettingsScreen() {
  return <SettingsHome />;
}
