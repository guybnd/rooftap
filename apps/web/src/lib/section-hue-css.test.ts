import { describe, expect, it } from "vitest";
import { SECTION_HUE_IDS, SECTION_HUES } from "@homeup/core";
import { sectionHueCss } from "./section-hue-css";

describe("sectionHueCss", () => {
  const css = sectionHueCss();

  it("declares every hue for both schemes", () => {
    for (const hue of SECTION_HUE_IDS) {
      expect(css).toContain(`[data-hue="${hue}"]{--hue-tile:${SECTION_HUES[hue].light.tile};`);
      expect(css).toContain(`.dark [data-hue="${hue}"]{--hue-tile:${SECTION_HUES[hue].dark.tile};`);
    }
  });

  it("sets the glow strength per scheme", () => {
    expect(css).toMatch(/:root\{--glow-opacity:0\.\d+\}/);
    expect(css).toMatch(/\.dark\{--glow-opacity:0\.\d+\}/);
  });
});
