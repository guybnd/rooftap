// HOUP-85: native port of apps/web's hero-customize-sheet.tsx. Toggling a
// switch flips one module immediately — no submit step, matching web.
// FLUX-258: the countdown row adds the sheet's first-ever text input, so its
// scroller swaps to `BottomSheetScrollView` — required (per
// packages/ui/src/components/bottom-sheet.tsx) so a nested scroller's native
// gesture cooperates with the sheet's whole-surface dismiss pan (HOUP-247)
// instead of racing it, the same class of defect HOUP-275 just fixed.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text, BottomSheet, BottomSheetScrollView, FormSection, FieldRow, Input, DateScrollField, Switch } from '@homeup/ui';
import type { UserSettings } from '@homeup/core';
import { useModules } from '@homeup/core';
import { availableHeroModules, isModuleEnabled, type HeroModuleGroup } from './hero-modules';

type Countdown = UserSettings['home_hero_countdown'];

const GROUP_LABELS: Record<HeroModuleGroup, string> = {
  header: 'Weather',
  day: 'Your day',
  home: 'Shortcuts, up to 3',
  tips: 'Smart tips',
  spaces: 'Spaces',
};

const GROUP_ORDER: HeroModuleGroup[] = ['header', 'day', 'tips', 'home', 'spaces'];

export function HeroCustomizeSheet({
  open,
  onOpenChange,
  config,
  onToggle,
  countdown,
  onCountdownChange,
  onCountdownFlush,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: Record<string, boolean>;
  onToggle: (key: string, on: boolean) => void;
  countdown: Countdown;
  onCountdownChange: (next: Countdown) => void;
  onCountdownFlush: () => void;
}) {
  // Modules: a hero module whose module is off isn't offered (module-features.ts);
  // a group left with none drops its header too.
  const { feature } = useModules();
  const available = availableHeroModules(feature);
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onCountdownFlush();
        onOpenChange(next);
      }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-5 px-4 py-4" className="max-h-[70vh]">
        {/* HOUP-298: plain `text-sm` (not the `text-body` step) — that step
            now carries its own fontFamily (Geist), which would fight
            `font-heading` for the same property; `text-sm` is the same 14px
            with no family opinion. */}
        <Text className="font-heading text-sm font-semibold text-foreground">Customize your summary</Text>
        {GROUP_ORDER.map((group) => {
          const modules = available.filter((m) => m.group === group);
          if (modules.length === 0) return null;
          return (
            <FormSection key={group} title={GROUP_LABELS[group]}>
              {modules.map((m) => {
                const isCountdownRow = m.key === 'countdown';
                const countdownOn = isCountdownRow && isModuleEnabled(m.key, config);
                return (
                  <FieldRow
                    key={m.key}
                    label={m.label}
                    hint={countdownOn ? undefined : m.description}
                    action={
                      <Switch checked={isModuleEnabled(m.key, config)} onChange={(on) => onToggle(m.key, on)} label={m.label} />
                    }
                  >
                    {countdownOn ? (
                      <CountdownFields countdown={countdown} onChange={onCountdownChange} description={m.description} />
                    ) : null}
                  </FieldRow>
                );
              })}
            </FormSection>
          );
        })}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function CountdownFields({
  countdown,
  onChange,
  description,
}: {
  countdown: Countdown;
  onChange: (next: Countdown) => void;
  description: string;
}) {
  const label = countdown?.label ?? '';
  const date = countdown?.date ?? '';
  return (
    <View className="gap-3">
      <Text className="text-xs text-muted-foreground">{description}</Text>
      <Input
        maxLength={60}
        placeholder="Event name"
        value={label}
        onChangeText={(next) => onChange({ label: next, date })}
      />
      <DateScrollField value={date} onChange={(next) => onChange({ label, date: next })} emptyLabel="No date set. Spin to pin one." />
      {countdown && (
        <Pressable onPress={() => onChange(null)}>
          <Text className="text-xs font-medium text-muted-foreground">Clear</Text>
        </Pressable>
      )}
    </View>
  );
}
