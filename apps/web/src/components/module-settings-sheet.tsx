"use client";

import { useState, type ReactNode } from "react";
import { getSection, moduleSettingsTitle, useModules } from "@homeup/core";
import { Settings } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { moduleSettingsComponents } from "@/app/settings/settings-registry";

// The second door to a module's settings (module-settings.ts): the module
// screen's More menu ends with "<Module> settings", which opens the same
// panels Settings > <Module> shows, as a sheet over the screen.
// Native twin: apps/mobile/src/features/settings/module-settings-sheet.tsx.

const SHEET =
  "max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4";

export interface ModuleSettingsDoor {
  /** False when the module has nothing to set for this household: leave the row out. */
  available: boolean;
  /** The row and sheet title, "Costs settings". */
  label: string;
  open: () => void;
  /** Render once in the screen. */
  sheet: ReactNode;
}

/** The settings row and sheet for a module screen's More menu. */
export function useModuleSettingsSheet(moduleId: string): ModuleSettingsDoor {
  const modules = useModules();
  const [open, setOpen] = useState(false);
  const panels = moduleSettingsComponents(moduleId, modules.enabled);
  const label = moduleSettingsTitle(getSection(moduleId)?.label ?? "Module");
  return {
    available: panels.length > 0,
    label,
    open: () => setOpen(true),
    sheet: panels.length ? (
      <BottomSheet open={open} onOpenChange={setOpen} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ "aria-label": label }}>
        <div className="space-y-4 pb-2 pt-1">
          <h2 className="px-1 font-heading text-lg font-semibold">{label}</h2>
          {panels.map((Panel, i) => <Panel key={i} />)}
        </div>
      </BottomSheet>
    ) : null,
  };
}

/**
 * A screen with no More menu takes this gear instead: it opens the module's
 * settings sheet, and renders nothing when the module has nothing to set.
 */
export function ModuleSettingsButton({ moduleId, className }: { moduleId: string; className?: string }) {
  const settings = useModuleSettingsSheet(moduleId);
  if (!settings.available) return null;
  return (
    <>
      <button
        type="button"
        onClick={settings.open}
        aria-label={settings.label}
        title={settings.label}
        className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground hover:bg-accent hover:text-foreground", className)}
      >
        <Settings className="h-4 w-4" />
      </button>
      {settings.sheet}
    </>
  );
}
