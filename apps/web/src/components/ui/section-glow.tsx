'use client';

// Hearth v2 (Pulse): the section glow — web twin of packages/ui's
// SectionGlow/TabGround. Mounted once by the app shell behind the routed
// content region, in the current section's hue (globals.css .section-glow),
// or the hue a page borrowed for a while (lib/glow-override.ts). It stays put
// on a section change, drifting to its place and blending into the new hue
// (Hearth §13.1).
import type { CSSProperties } from "react";
import { sectionHue } from "@homeup/core";
import { useGlowOverride } from "@/lib/glow-override";

export function SectionGlow({ sectionId, driftX }: { sectionId: string; driftX?: number }) {
  const borrowed = useGlowOverride();
  // Glow drift: the wash's centre across the width (core glowDriftX), eased
  // by the registered --glow-x. Without one it rests in the top right corner.
  const style = driftX === undefined ? undefined : ({ "--glow-x": `${driftX * 100}%` } as CSSProperties);
  return <div aria-hidden data-hue={sectionHue(borrowed ?? sectionId)} className="section-glow" style={style} />;
}
