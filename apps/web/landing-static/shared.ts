/// <reference types="vite/client" />
import { sectionHueCss } from "../src/lib/section-hue-css";

/** The section hues as CSS, once (the prerender already put them in the head). */
export function mountHues() {
  if (document.getElementById("section-hues")) return;
  const hues = document.createElement("style");
  hues.id = "section-hues";
  hues.textContent = sectionHueCss();
  document.head.appendChild(hues);
}

/** The live demo, built into ./demo by build:landing-static. */
export const DEMO_HREF = "./demo/?live=1&theme=ember-night";

export const landingProps = () => ({ signInHref: import.meta.env.VITE_SIGN_IN_URL || null, privacyHref: "./privacy.html", demoHref: DEMO_HREF });
