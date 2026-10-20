// Hearth v2 (Pulse, H1): the Hero lede — web twin of packages/ui's HeroLede.
// A surface leads with one huge number (`.text-hero` on Home,
// `.text-hero-section` on a section page) and says what it counts beside it:
// "3 of 7 left today", "12 to buy". At most one per surface.
// `layout="inline"` is the compact head (Groceries redesign): the label and
// caption stack in a column beside the number instead of under it, and
// `trailing` (the screen's head actions) sits on the right of the same row.
import { type ReactNode } from "react";
import { meterSegments } from "@homeup/core";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  neutral: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

export function HeroLede({
  value,
  label,
  caption,
  size = "section",
  meter,
  tone = "neutral",
  layout = "stacked",
  trailing,
  className,
}: {
  value: ReactNode;
  /** What the value counts, in words, set beside it. */
  label?: ReactNode;
  /** One muted line of secondary fragments under the number. */
  caption?: ReactNode;
  size?: "home" | "section";
  /** H3: the lede's own segmented meter. */
  meter?: { done: number; total: number };
  tone?: keyof typeof TONE_CLASS;
  /** "inline": label over caption beside the number, one row. Default "stacked". */
  layout?: "stacked" | "inline";
  /** Inline only: the head's actions, right-aligned on the lede's row. */
  trailing?: ReactNode;
  className?: string;
}) {
  if (layout === "inline") {
    // One grid row: number | label over caption | actions. The h1 is
    // `display: contents` so it still names the screen (number + label) while
    // its two children land in their own grid cells beside the caption.
    return (
      <div className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3", className)}>
        <h1 className="contents">
          <span className={cn("row-span-2 self-center", size === "home" ? "text-hero" : "text-hero-section", TONE_CLASS[tone])}>{value}</span>
          {label != null && (
            <span className={cn("col-start-2 truncate font-heading text-base font-semibold leading-tight text-muted-foreground", caption == null && "row-span-2")}>
              {label}
            </span>
          )}
        </h1>
        {caption != null && <p className="col-start-2 line-clamp-2 text-xs text-muted-foreground">{caption}</p>}
        {trailing != null && <div className="col-start-3 row-span-2 row-start-1 flex items-center gap-2">{trailing}</div>}
        {meter && <SegmentMeter className="col-span-3 mt-2" done={meter.done} total={meter.total} />}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h1 className="flex flex-wrap items-baseline gap-x-2.5">
        <span className={cn(size === "home" ? "text-hero" : "text-hero-section", TONE_CLASS[tone])}>{value}</span>
        {label != null && <span className="font-heading text-base font-semibold text-muted-foreground">{label}</span>}
      </h1>
      {meter && <SegmentMeter done={meter.done} total={meter.total} />}
      {caption != null && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

/**
 * H3 meter for a lede: one 3px segment per item, finished ones in coral. The
 * empty ones stay visible as a faint track with clear gaps between them, so
 * the meter reads as segments from the first item, not as one line. A
 * segment that fills sweeps the coral in from its left edge at slow (an undo
 * retreats it at fast); transform only, and reduced motion collapses the
 * --motion-* tokens to 0ms. Mounting never animates, only a change does.
 * `tone="success"` is the checklist meter (Hearth colour roles: checklist
 * meters are success), as on the Now card.
 */
export function SegmentMeter({
  done,
  total,
  max = 10,
  tone = "primary",
  className,
}: {
  done: number;
  total: number;
  max?: number;
  tone?: "primary" | "success";
  className?: string;
}) {
  const { count, filled } = meterSegments(done, total, max);
  if (count === 0) return null;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} done`}
      className={cn("flex max-w-sm gap-1.5", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/15">
          <span
            className={cn(
              "absolute inset-0 origin-left rounded-full transition-transform",
              tone === "success" ? "bg-success" : "bg-primary",
              i < filled
                ? "scale-x-100 duration-[var(--motion-slow)] ease-[var(--motion-ease-out)]"
                : "scale-x-0 duration-[var(--motion-fast)] ease-[var(--motion-ease-out)]"
            )}
          />
        </span>
      ))}
    </div>
  );
}
