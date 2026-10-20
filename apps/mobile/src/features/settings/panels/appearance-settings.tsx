// HOUP-84: native port of apps/web's appearance-settings.tsx + theme-switcher.tsx
// full (non-compact) list variant. Drives useAppTheme().setPreference (the
// stateful/persisted wrapper this ticket adds around @homeup/ui's
// ThemeProvider — see src/lib/theme-context.tsx) instead of rebuilding theming.
import { View } from 'react-native';
import { Palette, Vibrate } from 'lucide-react-native';
import { resolveOklchToRgba } from '@homeup/ui';
import { SYSTEM_THEME_IDS, THEME_TOKENS, type ThemeId } from '@homeup/core';
import { useHapticsPref } from '@/lib/haptics-pref';
import { useAppTheme } from '@/lib/theme-context';
import { themeMeta, type ThemeMeta } from '@/lib/theme-meta';
import { SettingsChoiceRow, SettingsInset, SettingsPanel, SettingsSwitchRow } from './settings-panel';

// Preview tile: the theme's real ground with a dot of its accent (the same
// THEME_TOKENS web reads), so Day and Night read apart at a glance where two
// coral dots would not. "Match device" shows its two resolutions side by side.
function GroundHalf({ themeId }: { themeId: ThemeId }) {
  const colors = THEME_TOKENS[themeId].colors;
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: resolveOklchToRgba(colors.background) }}>
      <View className="size-2.5 rounded-full" style={{ backgroundColor: resolveOklchToRgba(colors.primary) }} />
    </View>
  );
}

function ThemePreview({ id }: { id: ThemeMeta['id'] }) {
  return (
    <View className="size-9 flex-row overflow-hidden rounded-[11px] border border-border">
      {id === 'system' ? (
        <>
          <GroundHalf themeId={SYSTEM_THEME_IDS.light} />
          <GroundHalf themeId={SYSTEM_THEME_IDS.dark} />
        </>
      ) : (
        <GroundHalf themeId={id} />
      )}
    </View>
  );
}

export function AppearanceSettings() {
  const { preference, setPreference } = useAppTheme();

  return (
    <SettingsPanel icon={Palette} title="Appearance">
      <SettingsInset accessibilityRole="radiogroup">
        {themeMeta.map((t) => (
          <SettingsChoiceRow
            key={t.id}
            selected={t.id === preference}
            onSelect={() => setPreference(t.id)}
            leading={<ThemePreview id={t.id} />}
            title={t.name}
            description={t.description}
          />
        ))}
      </SettingsInset>
    </SettingsPanel>
  );
}

/** Hearth §9: one device-local switch for every pulse in the app. */
export function HapticsSettings() {
  const [on, setOn] = useHapticsPref();
  return (
    <SettingsPanel icon={Vibrate} title="Haptics">
      <SettingsInset>
        <SettingsSwitchRow
          title="Vibrate on taps and gestures"
          description="Clicks for toggles and swipes, a buzz as hold to edit fills, a roll when you finish a list."
          checked={on}
          onChange={setOn}
        />
      </SettingsInset>
    </SettingsPanel>
  );
}
