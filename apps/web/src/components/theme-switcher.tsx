"use client";

import { SYSTEM_THEME_IDS, THEME_TOKENS, type ThemeId } from "@homeup/core";
import { themes, type ThemeMeta } from "@/lib/themes";
import { SettingsChoiceRow, SettingsInset } from "@/components/settings-panel";
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
// accent (from the same THEME_TOKENS native reads), so Day and Night read
// apart at a glance where two coral dots would not. "Match device" shows its
// two resolutions side by side.
function GroundHalf({ themeId, className }: { themeId: ThemeId; className?: string }) {
  const colors = THEME_TOKENS[themeId].colors;
  return (
    <span className={cn("flex flex-1 items-center justify-center", className)} style={{ background: colors.background }}>
      <span className="size-2.5 rounded-full" style={{ background: colors.primary }} />
    </span>
  );
}

function ThemePreview({ id }: { id: ThemeMeta["id"] }) {
  return (
    <span aria-hidden className="flex size-9 overflow-hidden rounded-[11px] ring-1 ring-border">
      {id === "system" ? (
        <>
          <GroundHalf themeId={SYSTEM_THEME_IDS.light} />
          <GroundHalf themeId={SYSTEM_THEME_IDS.dark} />
        </>
      ) : (
        <GroundHalf themeId={id} />
      )}
    </span>
  );
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        {themes.map((t) => (
          <button
            key={t.id}
            onClick={() => setPreference(t.id)}
            title={t.name}
            aria-label={t.name}
            aria-pressed={preference === t.id}
            className={cn(
              "flex size-6 items-center justify-center rounded-full transition-all duration-150 ring-offset-sidebar ring-offset-2",
              preference === t.id ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100"
            )}
          >
            <Swatch accent={t.accent} className="size-4" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <SettingsInset role="radiogroup" aria-label="Theme">
      {themes.map((t) => (
        <SettingsChoiceRow
          key={t.id}
          selected={preference === t.id}
          onSelect={() => setPreference(t.id)}
          leading={<ThemePreview id={t.id} />}
          title={t.name}
          description={t.description}
        />
      ))}
    </SettingsInset>
  );
}
