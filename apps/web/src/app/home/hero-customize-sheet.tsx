'use client';

// FLUX-253: the summary-hero customize sheet. Bare BottomSheet (not
// ItemFormSheet — its Cancel/Save footer fights a live-toggle interaction).
// Toggling a switch flips one module immediately; no submit step.

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DateScrollField } from '@/components/date-scroll-field';
import type { UserSettings } from '@homeup/core';
import { useModules } from '@homeup/core';
import { availableHeroModules, isModuleEnabled, type HeroModuleGroup } from './hero-modules';

type Countdown = UserSettings['home_hero_countdown'];

const GROUP_LABELS: Record<HeroModuleGroup, string> = {
  header: 'Weather',
  day: 'Your day',
  home: 'Shortcuts, up to 3',
  tips: 'Smart tips',
};

const GROUP_ORDER: HeroModuleGroup[] = ['header', 'day', 'tips', 'home'];

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
      overlayClassName="bg-black/40 duration-200"
      className="flex-col bg-popover text-popover-foreground shadow-xl max-h-[88dvh] rounded-t-2xl border-t border-border sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
      popupProps={{ 'data-slot': 'hero-customize-sheet' }}
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-none px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="font-heading text-base font-semibold text-foreground">Customize your summary</p>
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
                      <Switch
                        checked={isModuleEnabled(m.key, config)}
                        onChange={(on) => onToggle(m.key, on)}
                        label={m.label}
                      />
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
      </div>
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
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{description}</p>
      <Input
        type="text"
        maxLength={60}
        placeholder="Event name"
        value={label}
        onChange={(e) => onChange({ label: e.target.value, date })}
      />
      <DateScrollField
        value={date}
        onChange={(next) => onChange({ label, date: next })}
        emptyLabel="No date set. Spin to pin one."
      />
      {countdown && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
