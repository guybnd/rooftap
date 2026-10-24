// The second door to a module's settings (module-settings.ts): the module
// screen's More menu ends with "<Module> settings", which opens the same
// panels Settings > <Module> shows, as a sheet over the screen.
// Web twin: apps/web/src/components/module-settings-sheet.tsx.
import * as React from 'react';
import { BottomSheet, BottomSheetScrollView, Text } from '@homeup/ui';
import { getSection, moduleSettingsTitle, useModules } from '@homeup/core';
import { moduleSettingsComponents } from './settings-registry';

export interface ModuleSettingsDoor {
  /** False when the module has nothing to set for this household: leave the row out. */
  available: boolean;
  /** The row and sheet title, "Costs settings". */
  label: string;
  open: () => void;
  /** Render once in the screen. */
  sheet: React.ReactNode;
}

/** The settings row and sheet for a module screen's More menu. */
export function useModuleSettingsSheet(moduleId: string): ModuleSettingsDoor {
  const modules = useModules();
  const [open, setOpen] = React.useState(false);
  const panels = moduleSettingsComponents(moduleId, modules.enabled);
  const label = moduleSettingsTitle(getSection(moduleId)?.label ?? 'Module');
  return {
    available: panels.length > 0,
    label,
    open: () => setOpen(true),
    sheet: panels.length ? (
      <BottomSheet open={open} onOpenChange={setOpen} className="max-h-[88%]" accessibilityLabel={label}>
        <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-4 pb-8">
          <Text className="px-1 pt-1 font-heading text-title font-semibold text-foreground">{label}</Text>
          {panels.map((Panel, i) => <Panel key={i} />)}
        </BottomSheetScrollView>
      </BottomSheet>
    ) : null,
  };
}
