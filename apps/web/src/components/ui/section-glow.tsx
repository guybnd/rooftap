'use client';

// Hearth v2 (Pulse): the section glow — web twin of packages/ui's
// SectionGlow/TabGround. Mounted once by the app shell behind the routed
// content region, in the current section's hue (globals.css .section-glow),
// or the hue a page borrowed for a while (lib/glow-override.ts). It stays put
// on a section change and blends into the new hue (Hearth §13.1).
import { sectionHue } from "@homeup/core";
import { useGlowOverride } from "@/lib/glow-override";

export function SectionGlow({ sectionId }: { sectionId: string }) {
  const borrowed = useGlowOverride();
  return <div aria-hidden data-hue={sectionHue(borrowed ?? sectionId)} className="section-glow" />;
}
