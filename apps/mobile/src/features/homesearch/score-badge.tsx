// HOUP-78: native port of apps/web/src/components/score-badge.tsx — an
// apartment's checklist-completion percentage (or "Fail" when a dealbreaker
// item has been answered "no").
//
// Hearth v2 pass (H2): a score is a state, so its hue tints the value and
// glyph only, never a filled block (was a solid success/warning/destructive
// pill). `overlay` (on a listing photo) adds a theme-ground glass chip so the
// tint stays legible over any image. Mirrors web.
import { View } from 'react-native';
import { ClipboardCheck } from 'lucide-react-native';
import { Text, cn } from '@homeup/ui';

export interface ScoreBadgeProps {
  percentage: number;
  hasDealbreakers?: boolean;
  size?: 'sm' | 'md';
  overlay?: boolean;
}

/** Hearth data tints: >= 80% success, 60-79% warning, < 60% or a dealbreaker danger. */
export function checklistScoreTone(percentage: number, hasDealbreakers?: boolean): string {
  if (hasDealbreakers || percentage < 60) return 'text-destructive';
  if (percentage >= 80) return 'text-success';
  return 'text-warning';
}

export function ScoreBadge({ percentage, hasDealbreakers, size = 'sm', overlay = false }: ScoreBadgeProps) {
  const tone = checklistScoreTone(percentage, hasDealbreakers);
  return (
    <View
      accessibilityLabel={hasDealbreakers ? 'Checklist: dealbreaker' : `Checklist: ${percentage}%`}
      className={cn(
        'flex-row items-center gap-1 self-start rounded-full',
        overlay && 'bg-background/85 px-2.5 py-1 shadow-sm'
      )}
    >
      <ClipboardCheck size={size === 'sm' ? 14 : 16} className={tone} />
      <Text
        className={cn('font-semibold tabular-nums', tone, size === 'sm' ? 'text-sm' : 'text-base')}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {hasDealbreakers ? 'Fail' : `${percentage}%`}
      </Text>
    </View>
  );
}
