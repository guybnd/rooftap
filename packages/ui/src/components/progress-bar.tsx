// HOUP-68: native port of apps/web/src/components/ui/progress-bar.tsx
// (H3: ~3px local meter).
import { View } from 'react-native';
import { cn } from '../lib/cn';

export interface ProgressBarProps {
  /** Numerator (e.g. ingredients you have). */
  value: number;
  /** Denominator (e.g. total ingredients). 0 renders an empty bar (no NaN). */
  total: number;
  /** Where the value is expected to end up (e.g. paid so far, then what is still to come). Drawn faint past `value`. */
  expected?: number;
  /** Bar fill colour class. Default success (theme token). */
  fillClassName?: string;
  /** Track background class. */
  trackClassName?: string;
  className?: string;
}

export function ProgressBar({
  value,
  total,
  expected,
  fillClassName = 'bg-success',
  trackClassName = 'bg-muted',
  className,
}: ProgressBarProps) {
  const share = (n: number) => (total > 0 ? Math.round((Math.max(0, Math.min(n, total)) / total) * 100) : 0);
  const pct = share(value);
  const ahead = expected != null ? Math.max(0, share(expected) - pct) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: value }}
      className={cn('h-[3px] w-full flex-row overflow-hidden rounded-full', trackClassName, className)}
    >
      <View className={cn('h-full rounded-full', fillClassName)} style={{ width: `${pct}%` }} />
      {ahead > 0 ? <View className={cn('h-full rounded-r-full', fillClassName)} style={{ width: `${ahead}%`, opacity: 0.3 }} /> : null}
    </View>
  );
}
