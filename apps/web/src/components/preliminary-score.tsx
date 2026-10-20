"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { cn } from "@/lib/utils";
import type { ApartmentPreliminaryScore } from '@homeup/core';

function getScoreColor(score: number) {
  if (score >= 8) return "text-success";
  if (score >= 5) return "text-warning";
  return "text-destructive";
}

interface PreliminaryScorePillProps {
  averageScore: number;
  count: number;
  /** On a photo: a theme-ground glass chip so the status hue stays legible. */
  overlay?: boolean;
}

// H2: the average is a state, so its hue tints the value and star only, never
// a filled block. Mirrors apps/mobile/src/features/homesearch/preliminary-score.tsx.
export function PreliminaryScorePill({ averageScore, count, overlay = false }: PreliminaryScorePillProps) {
  const display = averageScore % 1 === 0 ? averageScore.toFixed(0) : averageScore.toFixed(1);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full text-sm font-semibold tabular-nums",
        overlay && "bg-background/85 px-2.5 py-1 shadow-sm backdrop-blur-sm"
      )}
      title={`Average of ${count} rating${count !== 1 ? "s" : ""}`}
    >
      <Star className={cn("h-3.5 w-3.5 fill-current", getScoreColor(averageScore))} />
      <span className={getScoreColor(averageScore)}>{display}</span>
      <span className="text-xs font-medium text-muted-foreground">/10</span>
      {count > 1 && (
        <span className="text-xs font-medium text-muted-foreground">({count})</span>
      )}
    </span>
  );
}

interface ScoreStarsProps {
  value: number | null;
  onChange: (score: number | null) => void;
  disabled?: boolean;
  max?: number;
}

function ScoreStars({ value, onChange, disabled, max = 10 }: ScoreStarsProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div
      className="inline-flex items-center gap-0.5"
      onMouseLeave={() => setHovered(null)}
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const filled = hovered !== null ? n <= hovered : value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onMouseEnter={() => setHovered(n)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(n === value ? null : n);
            }}
            className={cn(
              "p-1 -m-0.5 transition-colors",
              filled ? "text-warning" : "text-muted-foreground/30 hover:text-warning/50",
              disabled && "opacity-50 pointer-events-none"
            )}
            aria-label={`Rate ${n} out of ${max}`}
          >
            <Star className={cn("h-4 w-4", filled && "fill-current")} />
          </button>
        );
      })}
      {value !== null && (
        <span className={cn("ml-2 text-sm font-semibold tabular-nums", getScoreColor(value))}>
          {value}/10
        </span>
      )}
    </div>
  );
}

interface UserScoreRowProps {
  name: string;
  avatar?: string | null;
  score: number;
  isCurrentUser?: boolean;
}

function UserScoreRow({ name, avatar, score, isCurrentUser }: UserScoreRowProps) {
  return (
    <div className="flex items-center gap-2">
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
      ) : (
        <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground uppercase">
          {name.charAt(0)}
        </span>
      )}
      <span className="text-sm text-muted-foreground flex-1 truncate">
        {name}{isCurrentUser && " (you)"}
      </span>
      <span className={cn("text-sm font-semibold tabular-nums", getScoreColor(score))}>
        {score}/10
      </span>
    </div>
  );
}

interface PreliminaryScoreInputProps {
  apartmentId: string;
  scores: ApartmentPreliminaryScore[];
}

export function PreliminaryScoreInput({ apartmentId, scores }: PreliminaryScoreInputProps) {
  const { refresh, currentUserId, memberProfiles } = useDataCache();
  const [saving, setSaving] = useState(false);

  const myScore = scores.find((s) => s.user_id === currentUserId);

  const handleChange = async (score: number | null) => {
    setSaving(true);
    const supabase = createClient();

    if (score === null && myScore) {
      await supabase
        .from("apartment_preliminary_scores")
        .delete()
        .eq("id", myScore.id);
    } else if (score !== null && myScore) {
      await supabase
        .from("apartment_preliminary_scores")
        .update({ score, updated_at: new Date().toISOString() })
        .eq("id", myScore.id);
    } else if (score !== null) {
      await supabase
        .from("apartment_preliminary_scores")
        .insert({ apartment_id: apartmentId, score });
    }

    await refresh();
    setSaving(false);
  };

  return (
    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <ScoreStars value={myScore?.score ?? null} onChange={handleChange} disabled={saving} />
    </div>
  );
}

interface PreliminaryScoreDetailProps {
  apartmentId: string;
  scores: ApartmentPreliminaryScore[];
}

export function PreliminaryScoreDetail({ apartmentId, scores }: PreliminaryScoreDetailProps) {
  const { currentUserId, memberProfiles, refresh } = useDataCache();
  const [saving, setSaving] = useState(false);

  const myScore = scores.find((s) => s.user_id === currentUserId);
  const otherScores = scores.filter((s) => s.user_id !== currentUserId);
  const avg = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
    : null;

  const handleChange = async (score: number | null) => {
    setSaving(true);
    const supabase = createClient();

    if (score === null && myScore) {
      await supabase
        .from("apartment_preliminary_scores")
        .delete()
        .eq("id", myScore.id);
    } else if (score !== null && myScore) {
      await supabase
        .from("apartment_preliminary_scores")
        .update({ score, updated_at: new Date().toISOString() })
        .eq("id", myScore.id);
    } else if (score !== null) {
      await supabase
        .from("apartment_preliminary_scores")
        .insert({ apartment_id: apartmentId, score });
    }

    await refresh();
    setSaving(false);
  };

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)] space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-base font-semibold flex items-center gap-1.5">
          <Star className="h-4 w-4 text-muted-foreground" />
          Preliminary score
        </h3>
        {avg !== null && (
          <PreliminaryScorePill averageScore={avg} count={scores.length} />
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Your rating</label>
        <ScoreStars value={myScore?.score ?? null} onChange={handleChange} disabled={saving} />
      </div>

      {otherScores.length > 0 && (
        <div className="border-t border-border/60 pt-3 space-y-2">
          <span className="text-xs text-muted-foreground">Group ratings</span>
          {otherScores.map((s) => {
            const profile = memberProfiles[s.user_id];
            const name = profile?.name || profile?.email?.split("@")[0] || "Member";
            return (
              <UserScoreRow
                key={s.id}
                name={name}
                avatar={profile?.avatar}
                score={s.score}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
