"use client";

import { cn } from "@/lib/utils";
import { ClipboardCheck } from "lucide-react";

interface ScoreBadgeProps {
  percentage: number;
  hasDealbreakers?: boolean;
  size?: "sm" | "md";
  /** On a photo: a theme-ground glass chip so the status hue stays legible. */
  overlay?: boolean;
}

/** Hearth data tints: >= 80% success, 60-79% warning, < 60% or a dealbreaker danger. */
export function checklistScoreTone(percentage: number, hasDealbreakers?: boolean) {
  if (hasDealbreakers || percentage < 60) return "text-destructive";
  if (percentage >= 80) return "text-success";
  return "text-warning";
}

// H2: a score is a state, so its hue tints the value and glyph only, never a
// filled block. Mirrors apps/mobile/src/features/homesearch/score-badge.tsx.
export function ScoreBadge({ percentage, hasDealbreakers, size = "sm", overlay = false }: ScoreBadgeProps) {
  const tone = checklistScoreTone(percentage, hasDealbreakers);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold tabular-nums",
        tone,
        overlay && "bg-background/85 px-2.5 py-1 shadow-sm backdrop-blur-sm",
        size === "sm" ? "text-sm" : "text-base"
      )}
      title={hasDealbreakers ? "Checklist: dealbreaker" : `Checklist: ${percentage}%`}
    >
      <ClipboardCheck className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {hasDealbreakers ? "Fail" : `${percentage}%`}
    </span>
  );
}
