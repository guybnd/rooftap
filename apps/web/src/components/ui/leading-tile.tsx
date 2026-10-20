// Hearth v2 (H2, line-item anatomy): the leading tile — web twin of
// packages/ui's LeadingTile. A rounded square in a section's identity hue
// holding that section's glyph; with the section glow, the only place a
// section hue may appear. Colours come from `data-hue` (lib/section-hue-css.ts).
import { sectionHue } from "@homeup/core";
import { cn } from "@/lib/utils";

export type LeadingTileSize = "sm" | "md" | "lg" | "xl";

// lg is the feed row's 42px tile; xl heads an item sheet.
const SIZE_CLASS: Record<LeadingTileSize, { box: string; icon: string }> = {
  sm: { box: "size-7 rounded-[9px]", icon: "size-[15px]" },
  md: { box: "size-9 rounded-[11px]", icon: "size-[18px]" },
  lg: { box: "size-[42px] rounded-[13px]", icon: "size-5" },
  xl: { box: "size-14 rounded-[17px]", icon: "size-[26px]" },
};

export function LeadingTile({
  sectionId,
  Icon,
  size = "lg",
  className,
}: {
  /** A sections.ts id. */
  sectionId: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: LeadingTileSize;
  className?: string;
}) {
  const dims = SIZE_CLASS[size];
  return (
    <span
      aria-hidden
      data-hue={sectionHue(sectionId)}
      className={cn("hue-tile inline-flex shrink-0 items-center justify-center", dims.box, className)}
    >
      <Icon className={dims.icon} strokeWidth={2.1} />
    </span>
  );
}
