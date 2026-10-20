// HOUP-91: native port of apps/web/src/components/ui/pulse-tile.tsx. Hearth
// §11 pulse-tile + H3 (local 3px meter, omitted for a delta/bare-count tile).
// HOUP-204: added the optional `Icon` slot — apps/web's local (non-shared)
// PulseTile in apps/home/hero-modules.tsx has always had one (e.g. Groceries'
// ShoppingCart); this shared component didn't, so every native pulse tile was
// icon-less regardless of caller intent.
// HOUP-222: added the optional `onPress` — web's local PulseTile is always
// its own button with a pressed-state affordance (usePressable's scale +
// `data-[pressed]:bg-muted/60`); this shared component had no press styling
// of its own, so navigable callers (home's hero grid) wrapped it in a bare
// `<Pressable>` with zero visual feedback on touch-down. `onPress` opts a
// tile into that same scale+bg affordance; display-only tiles (appointments/
// costs/groceries/setup KPI strips) omit it and stay a plain View.
import { type ComponentType, type ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps, type ViewProps } from 'react-native';
import { cn } from '../lib/cn';
import { ProgressBar } from './progress-bar';

export type PulseTileIcon = ComponentType<{ size?: number; className?: string }>;

export type PulseTileTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_VALUE_CLASS: Record<PulseTileTone, string> = {
  neutral: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

const TONE_FILL_CLASS: Record<PulseTileTone, string> = {
  neutral: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

export interface PulseTileProps extends ViewProps {
  /** Micro-label (T4: 10.5px uppercase +0.1em). */
  label: string;
  /** Optional leading glyph next to the label, matching web's local PulseTile Icon slot. */
  Icon?: PulseTileIcon;
  /** Tabular, value-first; unit/qualifier text should be wrapped in a muted child by the caller. */
  value: ReactNode;
  /** Omit for a meter-less tile (a delta or bare count, not a fraction of a whole). */
  meter?: { value: number; total: number };
  tone?: PulseTileTone;
  /** Makes the tile its own tap target with the Hearth pressed-state affordance (scale + bg tint). Omit for a display-only tile. */
  onPress?: PressableProps['onPress'];
  /** Hearth v2: a shortcut whose lens is open on Home wears a coral ring (interactive state, H2). */
  selected?: boolean;
}

export function PulseTile({ label, Icon, value, meter, tone = 'neutral', className, onPress, selected, ...props }: PulseTileProps) {
  const content = (
    <>
      <View className="flex-row items-center gap-1">
        {Icon && <Icon size={12} className="shrink-0 text-muted-foreground" />}
        <Text numberOfLines={1} className="text-micro-label uppercase text-muted-foreground">
          {label}
        </Text>
      </View>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text className={cn('text-sm font-semibold tabular-nums', TONE_VALUE_CLASS[tone])}>{value}</Text>
      ) : (
        value
      )}
      {meter && (
        <ProgressBar
          value={meter.value}
          total={meter.total}
          fillClassName={TONE_FILL_CLASS[tone]}
          className="h-[3px]"
        />
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={selected !== undefined ? { selected } : undefined}
        className={cn(
          'min-h-11 flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5 active:scale-[0.97] active:bg-muted/60',
          className,
          // The ring is drawn as a border on every lens tile so turning it on doesn't nudge the layout.
          selected !== undefined && 'border-[1.5px]',
          selected ? 'border-primary' : selected === false && 'border-transparent',
        )}
        {...props}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View className={cn('min-h-11 flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5', className)} {...props}>
      {content}
    </View>
  );
}
