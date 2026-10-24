// The goal status under a spend bar, a dot per line (core goalStatus): the
// Costs hero and Home's Budget space. Web twin:
// apps/web/src/app/costs/goal-status.tsx.
import { View } from 'react-native';
import { Text, cn } from '@homeup/ui';
import type { GoalStatusLine } from '@homeup/core';

const TABULAR = { fontVariant: ['tabular-nums' as const] };
const DOT: Record<GoalStatusLine['tone'], string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-muted-foreground' };

export function GoalStatusLines({ lines }: { lines: readonly GoalStatusLine[] }) {
  return (
    <View className="gap-1 pt-0.5">
      {lines.map((l, i) => (
        <View key={i} className="flex-row items-center gap-2">
          <View className={cn('h-2 w-2 rounded-full', DOT[l.tone])} />
          <Text className="flex-1 text-sm font-semibold text-foreground" style={TABULAR}>
            {l.lead}
            {l.detail ? <Text className="text-sm font-normal text-muted-foreground">{` ${l.detail}`}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}
