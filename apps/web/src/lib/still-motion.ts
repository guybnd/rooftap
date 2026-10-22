// Motion is still when the device asks for reduced motion or the page wears
// the e-paper theme (core's STILL_THEME_IDS). CSS covers most of it (the
// --motion-* tokens go to 0ms under both); this is for the few places that
// animate from script.
import { STILL_THEME_IDS } from "@homeup/core";

export function prefersStillMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
  const theme = document.documentElement.getAttribute("data-theme");
  return !!theme && (STILL_THEME_IDS as readonly string[]).includes(theme);
}
