// HOUP-78: native port of apps/web/src/components/preliminary-score.tsx — a
// group's rough "worth revisiting?" star rating (1-10) for an apartment,
// separate from the full checklist score. Exports the compact average+count
// pill, the current user's star input (writes straight to
// apartment_preliminary_scores, mirroring the web original's exact upsert
// shape: delete on null / update on an existing row / insert otherwise), and
// a detail card combining both with the rest of the group's ratings.
//
// The web original's hover-preview star state has no touch equivalent —
// dropped; a press commits immediately with an optimistic local highlight
// while the write is in flight. `PreliminaryScoreDetail` reuses
// `PreliminaryScoreInput` for "your rating" instead of duplicating the star
// row a second time (the web original duplicates the whole handler).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { Card, Text, cn } from '@homeup/ui';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { useDataCache } from '@/lib/data-cache';
import type { ApartmentPreliminaryScore } from '@homeup/core';

function scoreTextClassName(score: number): string {
  if (score >= 8) return 'text-success';
  if (score >= 5) return 'text-warning';
  return 'text-destructive';
}

export interface PreliminaryScorePillProps {
  averageScore: number;
  count: number;
  /** On a listing photo: a theme-ground glass chip so the tint stays legible. */
  overlay?: boolean;
}

// Hearth v2 pass (H2): the average is a state, so its hue tints the value and
// star only, never a filled block (was a solid status pill). Mirrors web.
export function PreliminaryScorePill({ averageScore, count, overlay = false }: PreliminaryScorePillProps) {
  const display = averageScore % 1 === 0 ? averageScore.toFixed(0) : averageScore.toFixed(1);
  const tone = scoreTextClassName(averageScore);
  return (
    <View
      accessibilityLabel={`Average ${display} of 10 from ${count} rating${count !== 1 ? 's' : ''}`}
      className={cn('flex-row items-center gap-1 self-start rounded-full', overlay && 'bg-background/85 px-2.5 py-1 shadow-sm')}
    >
      <Star size={14} fill="currentColor" className={tone} />
      <Text className={cn('text-sm font-semibold tabular-nums', tone)} style={{ fontVariant: ['tabular-nums'] }}>
        {display}
      </Text>
      <Text className="text-xs font-medium text-muted-foreground">/10</Text>
      {count > 1 && <Text className="text-xs font-medium text-muted-foreground">({count})</Text>}
    </View>
  );
}

interface ScoreStarsProps {
  value: number | null;
  onChange: (score: number | null) => void;
  disabled?: boolean;
  max?: number;
}

function ScoreStars({ value, onChange, disabled, max = 10 }: ScoreStarsProps) {
  return (
    <View className="flex-row items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const filled = value !== null && n <= value;
        return (
          <Pressable
            key={n}
            disabled={disabled}
            onPress={() => onChange(n === value ? null : n)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${n} out of ${max}`}
            className={cn('p-1', disabled && 'opacity-50')}
          >
            <Star
              size={16}
              fill={filled ? 'currentColor' : 'none'}
              className={filled ? 'text-warning' : 'text-muted-foreground/30'}
            />
          </Pressable>
        );
      })}
      {value !== null && (
        <Text
          className={cn('ml-1.5 text-sm font-semibold tabular-nums', scoreTextClassName(value))}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {value}/10
        </Text>
      )}
    </View>
  );
}

async function persistScore(
  apartmentId: string,
  myScore: ApartmentPreliminaryScore | undefined,
  score: number | null
) {
  const supabase = getCurrentSupabaseClient();
  if (score === null && myScore) {
    await supabase.from('apartment_preliminary_scores').delete().eq('id', myScore.id);
  } else if (score !== null && myScore) {
    await supabase
      .from('apartment_preliminary_scores')
      .update({ score, updated_at: new Date().toISOString() })
      .eq('id', myScore.id);
  } else if (score !== null) {
    await supabase.from('apartment_preliminary_scores').insert({ apartment_id: apartmentId, score });
  }
}

export interface PreliminaryScoreInputProps {
  apartmentId: string;
  scores: ApartmentPreliminaryScore[];
}

export function PreliminaryScoreInput({ apartmentId, scores }: PreliminaryScoreInputProps) {
  const { refresh, currentUserId } = useDataCache();
  const [saving, setSaving] = React.useState(false);
  // Optimistic star highlight shown while the write is in flight; `undefined`
  // means "defer to the scores prop" (the normal, settled state).
  const [optimistic, setOptimistic] = React.useState<number | null | undefined>(undefined);

  const myScore = scores.find((s) => s.user_id === currentUserId);
  const displayValue = optimistic !== undefined ? optimistic : myScore?.score ?? null;

  const handleChange = async (score: number | null) => {
    setOptimistic(score);
    setSaving(true);
    try {
      await persistScore(apartmentId, myScore, score);
      await refresh();
    } finally {
      setOptimistic(undefined);
      setSaving(false);
    }
  };

  return <ScoreStars value={displayValue} onChange={handleChange} disabled={saving} />;
}

export interface PreliminaryScoreDetailProps {
  apartmentId: string;
  scores: ApartmentPreliminaryScore[];
}

export function PreliminaryScoreDetail({ apartmentId, scores }: PreliminaryScoreDetailProps) {
  const { currentUserId, memberProfiles } = useDataCache();

  const otherScores = scores.filter((s) => s.user_id !== currentUserId);
  const avg = scores.length > 0 ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : null;

  return (
    <Card className="gap-3 rounded-3xl p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Star size={16} className="text-muted-foreground" />
          <Text className="font-heading text-title text-foreground">Preliminary score</Text>
        </View>
        {avg !== null && <PreliminaryScorePill averageScore={avg} count={scores.length} />}
      </View>

      <View className="gap-1.5">
        <Text className="text-xs text-muted-foreground">Your rating</Text>
        <PreliminaryScoreInput apartmentId={apartmentId} scores={scores} />
      </View>

      {otherScores.length > 0 && (
        <View className="gap-2 border-t border-border/60 pt-3">
          <Text className="text-xs text-muted-foreground">Group ratings</Text>
          {otherScores.map((s) => {
            const profile = memberProfiles[s.user_id];
            const name = profile?.name || profile?.email?.split('@')[0] || 'Member';
            return (
              <View key={s.id} className="flex-row items-center gap-2">
                <View className="h-5 w-5 items-center justify-center rounded-full bg-muted">
                  <Text className="text-[10px] font-medium uppercase text-muted-foreground">{name.charAt(0)}</Text>
                </View>
                <Text numberOfLines={1} className="flex-1 text-sm text-muted-foreground">
                  {name}
                </Text>
                <Text
                  className={cn('text-sm font-semibold tabular-nums', scoreTextClassName(s.score))}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {s.score}/10
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}
