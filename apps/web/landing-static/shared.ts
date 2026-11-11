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

const signIn = (): string | null => import.meta.env.VITE_SIGN_IN_URL || null;

/** The household page's links in the static site. */
export const landingProps = (signInHref = signIn()) => ({ signInHref, privacyHref: "./privacy.html", selfHostHref: "./self-host.html", demoHref: DEMO_HREF });

/** The self-host page's links in the static site. */
export const selfHostProps = (signInHref = signIn()) => ({ signInHref, homeHref: "./", privacyHref: "./privacy.html", demoHref: DEMO_HREF });
