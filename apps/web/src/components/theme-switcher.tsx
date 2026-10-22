"use client";

import {
  THEME_TOKENS,
  familyHasModes,
  preferenceFamily,
  preferenceMode,
  themeFamily,
  themePreference,
  type ThemeFamilyId,
  type ThemeId,
  type ThemeMode,
} from "@homeup/core";
import { themeModes, themes, type ThemeMeta } from "@/lib/themes";
import { SettingsChoiceRow, SettingsInset } from "@/components/settings-panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

function Swatch({ accent, className }: { accent: ThemeMeta["accent"]; className?: string }) {
  if (Array.isArray(accent)) {
    return (
      <span
        className={cn("rounded-full ring-1 ring-border", className)}
        style={{ background: `linear-gradient(90deg, ${accent[0]} 50%, ${accent[1]} 50%)` }}
      />
    );
  }
  return <span className={cn("rounded-full ring-1 ring-border", className)} style={{ backgroundColor: accent }} />;
}

// Appearance list preview: a tile of the theme's real ground with a dot of its
// accent (from the same THEME_TOKENS native reads). A family with two
// variants shows both side by side, so the tile reads the same in any mode.
function GroundHalf({ themeId, className }: { themeId: ThemeId; className?: string }) {
  const colors = THEME_TOKENS[themeId].colors;
  return (
    <span className={cn("flex flex-1 items-center justify-center", className)} style={{ background: colors.background }}>
      <span className="size-2.5 rounded-full" style={{ background: colors.primary }} />
    </span>
  );
}

function ThemePreview({ id }: { id: ThemeFamilyId }) {
  const { variants } = themeFamily(id);
  return (
    <span aria-hidden className="flex size-9 overflow-hidden rounded-[11px] ring-1 ring-border">
      <GroundHalf themeId={variants.light} />
      {variants.dark !== variants.light && <GroundHalf themeId={variants.dark} />}
    </span>
  );
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  const family = preferenceFamily(preference);
  const mode = preferenceMode(preference);

  if (compact) {
    // The sidebar's quick picker: families only, keeping the current mode.
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        {themes.map((t) => (
          <button
            key={t.id}
            onClick={() => setPreference(themePreference(t.id, mode))}
            title={t.name}
            aria-label={t.name}
            aria-pressed={family === t.id}
            className={cn(
              "flex size-6 items-center justify-center rounded-full transition-all duration-150 ring-offset-sidebar ring-offset-2",
              family === t.id ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100"
            )}
          >
            <Swatch accent={t.accent} className="size-4" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* H6: the mode switch sits with the list it changes, above it. */}
      <div className="space-y-1.5">
        <SegmentedControl<ThemeMode>
          options={themeModes}
          value={mode}
          onChange={(next) => setPreference(themePreference(family, next))}
          ariaLabel="Light or dark"
        />
        <p className="px-1 text-xs text-muted-foreground">
          {familyHasModes(family)
            ? "Auto follows your device. Light and Dark apply to any theme."
            : "E-Ink has one look, so it stays light in every mode."}
        </p>
      </div>
      <SettingsInset role="radiogroup" aria-label="Theme">
        {themes.map((t) => (
          <SettingsChoiceRow
            key={t.id}
            selected={family === t.id}
            onSelect={() => setPreference(themePreference(t.id, mode))}
            leading={<ThemePreview id={t.id} />}
            title={t.name}
            description={t.description}
          />
        ))}
      </SettingsInset>
    </div>
  );
}
