// Landing page three.js helpers. `three` itself is only ever loaded with a
// dynamic import from StoryStage, so the scene takes the module as an
// argument instead of importing it.
import type * as ThreeModule from "three";

export type Three = typeof ThreeModule;

export interface Pointer {
  x: number;
  y: number;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

let probe: CanvasRenderingContext2D | null = null;

/** Resolves any CSS colour (the theme tokens are oklch) to a hex string three.js can read. */
export function cssColorToHex(css: string): string {
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return "#000000";
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
