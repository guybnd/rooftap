// The prerender's entry (prerender.mjs): each page as HTML, so crawlers,
// link previews and visitors without JavaScript get the whole page.
import { renderToString } from "react-dom/server";
import { LandingPage } from "../src/components/landing/landing-page";
import { PrivacyPage } from "../src/components/landing/privacy-page";
import { SelfHostPage } from "../src/components/landing/self-host-page";
import { sectionHueCss } from "../src/lib/section-hue-css";
import { landingProps, selfHostProps } from "./shared";

export const hues = sectionHueCss;

export function render(page: "index" | "self-host" | "privacy", signInHref: string | null): string {
  if (page === "index") return renderToString(<LandingPage {...landingProps(signInHref)} />);
  if (page === "self-host") return renderToString(<SelfHostPage {...selfHostProps(signInHref)} />);
  return renderToString(<PrivacyPage homeHref="./" />);
}
