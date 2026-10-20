// The prerender's entry (prerender.mjs): each page as HTML, so crawlers,
// link previews and visitors without JavaScript get the whole page.
import { renderToString } from "react-dom/server";
import { LandingPage } from "../src/components/landing/landing-page";
import { PrivacyPage } from "../src/components/landing/privacy-page";
import { sectionHueCss } from "../src/lib/section-hue-css";
import { DEMO_HREF } from "./shared";

export const hues = sectionHueCss;

export function render(page: "index" | "privacy", signInHref: string | null): string {
  return page === "index" ? renderToString(<LandingPage signInHref={signInHref} privacyHref="./privacy.html" demoHref={DEMO_HREF} />) : renderToString(<PrivacyPage homeHref="./" />);
}
