// HOUP-174 (item 1): native port of apps/web/src/components/dashboard-stats.tsx
// — the quick-filter stat grid under the Home search Hero lede (replaced the
// horizontal quick-filter Pill row the screen shipped with under HOUP-78).
//
// Hearth v2 pass:
// - H1: no Total/All tile. The Hero counts the listings in play and "all" is
//   just the unfiltered list (tap the active tile again to clear), so a Total
//   tile restated the lede. The caller passes only the filter tiles.
// - Empty chrome: a tile with a zero hides unless it is the active one.
// - H2: coral marks the active (interactive) tile only; a value takes a status
//   hue only when it is a state (`tone: 'warning'` for Rebook).
// - Tiles share PulseTile's dress (inset `bg-muted/40`, label row over a
//   tabular value), sentence-case labels that never wrap.
//
// Layout: RN has no CSS grid; a `flex-row flex-wrap` of fixed thirds (web's
// `grid-cols-3`) so a short last row keeps tile widths instead of stretching.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text, cn } from '@homeup/ui';

export type DashboardStatTone = 'neutral' | 'warning';

export type DashboardStatIcon = React.ComponentType<{ size?: number; className?: string }>;

export interface DashboardStat<K extends string = string> {
  key: K;
  icon: DashboardStatIcon;
  label: string;
  value: number;
  tone?: DashboardStatTone;
}

export interface DashboardStatsProps<K extends string = string> {
  stats: DashboardStat<K>[];
  activeKey: K;
  onSelect: (key: K) => void;
}

export function DashboardStats<K extends string = string>({ stats, activeKey, onSelect }: DashboardStatsProps<K>) {
  const visible = stats.filter((s) => s.value > 0 || s.key === activeKey);
  if (visible.length === 0) return null;
  return (
    <View className="-m-1 flex-row flex-wrap" accessibilityLabel="Quick filters">
      {visible.map((stat) => {
        const active = activeKey === stat.key;
        const Icon = stat.icon;
        return (
          <View key={stat.key} className="w-1/3 p-1">
            <Pressable
              onPress={() => onSelect(stat.key)}
              accessibilityRole="button"
              accessibilityLabel={`${stat.label}, ${stat.value}`}
              accessibilityState={{ selected: active }}
              className={cn(
                'min-h-[52px] gap-1 rounded-xl border px-3 py-2.5 active:scale-[0.97]',
                active ? 'border-primary/40 bg-primary/10' : 'border-transparent bg-muted/40 active:bg-muted/60'
              )}
            >
              <View className="flex-row items-center gap-1">
                <Icon size={12} className={active ? 'text-primary' : 'text-muted-foreground'} />
                <Text
                  numberOfLines={1}
                  className={cn('text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground')}
                >
                  {stat.label}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  stat.tone === 'warning' && stat.value > 0 ? 'text-warning' : 'text-foreground'
                )}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {stat.value}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
