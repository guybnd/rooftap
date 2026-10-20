// HOUP-68: native port of apps/web/src/components/ui/progress-bar.tsx
// (H3: ~3px local meter).
import { View } from 'react-native';
import { cn } from '../lib/cn';

export interface ProgressBarProps {
  /** Numerator (e.g. ingredients you have). */
  value: number;
  /** Denominator (e.g. total ingredients). 0 renders an empty bar (no NaN). */
  total: number;
  /** Bar fill colour class. Default success (theme token). */
  fillClassName?: string;
  /** Track background class. */
  trackClassName?: string;
  className?: string;
}

export function ProgressBar({
  value,
  total,
  fillClassName = 'bg-success',
  trackClassName = 'bg-muted',
  className,
}: ProgressBarProps) {
  const pct = total > 0 ? Math.round((Math.min(value, total) / total) * 100) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: value }}
      className={cn('h-[3px] w-full overflow-hidden rounded-full', trackClassName, className)}
    >
      <View className={cn('h-full rounded-full', fillClassName)} style={{ width: `${pct}%` }} />
    </View>
  );
}
