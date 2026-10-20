// HOUP-88: native port of apps/web/src/app/setup/segmented-bar.tsx. A
// left-to-right progress meter (H3, ~3px): what's been bought fills from the
// left in the done hue, and the track carries what is still needed. Renders
// nothing when empty.
import { View } from 'react-native';
import { cn } from '@homeup/ui';
import { STATUS_FILL } from './setup-status';

interface SegmentedBarProps {
  counts: Record<string, number>;
  className?: string;
}

export function SegmentedBar({ counts, className }: SegmentedBarProps) {
  const done = counts.installed ?? 0;
  const total = done + (counts.needed ?? 0);
  if (total === 0) return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
      className={cn('h-[3px] flex-row overflow-hidden rounded-full', STATUS_FILL.needed, className)}
    >
      {done > 0 && <View className={cn('h-full rounded-full', STATUS_FILL.installed)} style={{ width: `${(done / total) * 100}%` }} />}
    </View>
  );
}
