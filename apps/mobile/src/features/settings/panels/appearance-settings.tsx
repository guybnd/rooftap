// HOUP-84: native port of apps/web's appearance-settings.tsx + theme-switcher.tsx
// full (non-compact) list variant. Drives useAppTheme().setPreference (the
// stateful/persisted wrapper this ticket adds around @homeup/ui's
// ThemeProvider — see src/lib/theme-context.tsx) instead of rebuilding theming.
import { View } from 'react-native';
import { Gauge, Palette, Vibrate } from 'lucide-react-native';
import { SegmentedControl, Text, resolveOklchToRgba } from '@homeup/ui';
import {
  THEME_TOKENS,
  familyHasModes,
  preferenceFamily,
  preferenceMode,
  setNavSpeed,
  themeFamily,
  themePreference,
  useNavSpeed,
  type NavSpeed,
  type ThemeFamilyId,
  type ThemeId,
  type ThemeMode,
} from '@homeup/core';
import { useHapticsPref } from '@/lib/haptics-pref';
import { useAppTheme } from '@/lib/theme-context';
import { themeMeta, themeModes } from '@/lib/theme-meta';
import { SettingsChoiceRow, SettingsInset, SettingsPanel, SettingsSwitchRow } from './settings-panel';

// Preview tile: the theme's real ground with a dot of its accent (the same
// THEME_TOKENS web reads). A family with two variants shows both side by
// side, so the tile reads the same whatever the mode.
function GroundHalf({ themeId }: { themeId: ThemeId }) {
  const colors = THEME_TOKENS[themeId].colors;
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: resolveOklchToRgba(colors.background) }}>
      <View className="size-2.5 rounded-full" style={{ backgroundColor: resolveOklchToRgba(colors.primary) }} />
    </View>
  );
}

function ThemePreview({ id }: { id: ThemeFamilyId }) {
  const { variants } = themeFamily(id);
  return (
    <View className="size-9 flex-row overflow-hidden rounded-[11px] border border-border">
      <GroundHalf themeId={variants.light} />
      {variants.dark !== variants.light && <GroundHalf themeId={variants.dark} />}
    </View>
  );
}

export function AppearanceSettings() {
  const { preference, setPreference } = useAppTheme();
  const family = preferenceFamily(preference);
  const mode = preferenceMode(preference);

  return (
    <SettingsPanel icon={Palette} title="Appearance">
      {/* H6: the control sits with the list it changes, above it. */}
      <View className="gap-1.5">
        <SegmentedControl<ThemeMode>
          options={themeModes}
          value={mode}
          onChange={(next) => setPreference(themePreference(family, next))}
          accessibilityLabel="Light or dark"
        />
        <Text className="px-1 text-caption text-muted-foreground">
          {familyHasModes(family)
            ? 'Auto follows your device. Light and Dark apply to any theme.'
            : 'E-Ink has one look, so it stays light in every mode.'}
        </Text>
      </View>
      <SettingsInset accessibilityRole="radiogroup">
        {themeMeta.map((t) => (
          <SettingsChoiceRow
            key={t.id}
            selected={t.id === family}
            onSelect={() => setPreference(themePreference(t.id, mode))}
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

const NAV_SPEED_CHOICES: { id: NavSpeed; title: string; description: string }[] = [
  { id: 'fast', title: 'Fast', description: 'Pages snap into place.' },
  { id: 'smooth', title: 'Smooth', description: 'Pages and the colour glow glide in a little slower.' },
];

/** Hearth §8 "Navigation speed": how fast pages move when you switch spaces, on this device. */
export function MotionSettings() {
  const speed = useNavSpeed();
  return (
    <SettingsPanel icon={Gauge} title="Animation speed">
      <SettingsInset accessibilityRole="radiogroup">
        {NAV_SPEED_CHOICES.map((choice) => (
          <SettingsChoiceRow
            key={choice.id}
            selected={choice.id === speed}
            onSelect={() => setNavSpeed(choice.id)}
            title={choice.title}
            description={choice.description}
          />
        ))}
      </SettingsInset>
    </SettingsPanel>
  );
}
