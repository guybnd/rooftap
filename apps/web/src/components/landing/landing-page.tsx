"use client";

import { Fragment, useEffect, useRef, type MouseEvent } from "react";
import { sectionHue } from "@homeup/core";
import { cn } from "@/lib/utils";
import { SectionTile } from "./cards";
import { APK_URL, COMPARE, EINK_FACTS, HERO_FACTS, HERO_TILES, HOUSEHOLD_FAQ, LAYOUT_FACTS, WEB_APP_URL } from "./content";
import { HeroPhone } from "./hero-phone";
import { ModuleMap } from "./module-map";
import { DESKTOP_ALT, EINK_ALT, EINK_H, EINK_W, SCREEN_ALT, desktopScreenSrc, einkScreenSrc, screenSrc } from "./screens";
import { Faq, LandingShell, SectionHead } from "./shell";
import styles from "./landing.module.css";
import { ASSISTANT_STORY, MCP_STORY, SHOPPER_STORY, STORIES } from "./stories";
import { StoryPlayer, storyAnchor } from "./story-player";

/**
 * The household page's tiles: every story but the ones for people who run a
 * server (MCP) or that only work in Australia today (Shopper's price sources).
 */
const HOUSEHOLD_STORIES = STORIES.filter((s) => s !== MCP_STORY && s !== SHOPPER_STORY);

/** Closes the Tiles menu once a tile is picked. */
function closeMenuOnPick(e: MouseEvent<HTMLDetailsElement>) {
  if ((e.target as Element).closest("a")) e.currentTarget.open = false;
}

/** The top bar's Tiles menu: a jump to each tile's story. */
function TilesMenu() {
  // A tap anywhere outside the open menu closes it.
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details ref={menuRef} className={styles.navMenu} onClick={closeMenuOnPick}>
      <summary className={styles.navLink}>Tiles</summary>
      <div className={styles.navMenuList}>
        {HOUSEHOLD_STORIES.map((story) => (
          <a key={story.id} href={`#${storyAnchor(story)}`}>
            <SectionTile sectionId={story.room} small />
            {story.name}
          </a>
        ))}
      </div>
    </details>
  );
}

/**
 * The public front page, for households. Running a server (Docker, the
 * stack, the Assistant's setup, MCP, the licence) is on the self-host page
 * (self-host-page.tsx), which this page links to.
 */
export function LandingPage({
  signInHref = "/login",
  privacyHref = "/privacy",
  selfHostHref = "/self-host",
  termsHref = null,
  demoHref = null,
}: {
  signInHref?: string | null;
  privacyHref?: string;
  /** The hosted service's Terms. The static site has none, so it leaves this out. */
  termsHref?: string | null;
  /** The page for people who run their own server. */
  selfHostHref?: string;
  /** The live demo's address. Only the static site builds the demo. */
  demoHref?: string | null;
}) {
  return (
    <LandingShell
      signInHref={signInHref}
      navStart={<TilesMenu />}
      nav={[
        { label: "Assistant", href: `#${storyAnchor(ASSISTANT_STORY)}` },
        { label: "Price", href: "#price" },
        { label: "FAQ", href: "#faq" },
        { label: "Self-host", href: selfHostHref },
      ]}
      footerLinks={[
        { label: "Tiles", href: "#modules" },
        { label: "Price", href: "#price" },
        { label: "FAQ", href: "#faq" },
        { label: "Run your own server", href: selfHostHref },
        { label: "Privacy", href: privacyHref },
        ...(termsHref ? [{ label: "Terms", href: termsHref }] : []),
      ]}
      footerLine="One shared app for everyone under your roof."
    >
      <section id="top" className={styles.hero} aria-labelledby="hero-title">
        <div className={cn(styles.wrap, styles.heroInner)}>
          <div className={styles.heroText}>
            <h1 id="hero-title" className={cn(styles.display, styles.heroTitle)}>
              Everything under one roof.
            </h1>
            <p className={styles.sectionLede}>Share it with the people you live with. Turn on the tiles you need.</p>
            <ul className={styles.heroChips} aria-label="Tiles">
              {HERO_TILES.map(([label, section]) => (
                <li key={label} data-hue={sectionHue(section)}>
                  {label}
                </li>
              ))}
              <li className={styles.heroChipMore}>and more</li>
            </ul>
            <div className={styles.heroCtas}>
              <div className={cn(styles.heroCtaMain, styles.ctaOne)}>
                <a href={WEB_APP_URL} className={styles.button}>
                  Use the app
                </a>
              </div>
              <div className={styles.heroCtaMore}>
                <a href={APK_URL} className={styles.heroCtaLink}>
                  Android app
                </a>
                <a href={selfHostHref} className={styles.heroCtaLink}>
                  Run it on your own server
                </a>
              </div>
            </div>
            <p className={cn(styles.heroFacts, styles.heroMore)}>
              {HERO_FACTS.map((line) => (
                <span key={line.join()} className={styles.heroFactsLine}>
                  {line.map((fact, i) => (
                    <Fragment key={fact}>
                      {i > 0 && " "}
                      <span>{i < line.length - 1 ? `${fact} ·` : fact}</span>
                    </Fragment>
                  ))}
                </span>
              ))}
            </p>
          </div>
          <HeroPhone demoHref={demoHref} />
        </div>
      </section>

      <section id="fits" className={styles.section} aria-labelledby="fits-title">
        <div className={styles.wrap}>
          <SectionHead
            id="fits"
            title="Dynamic and interconnected"
            lede="Most actions do more than one thing. Plan to buy a TV and you get a to-do and a line in the budget. Finish a shopping trip and its total goes to Costs. You do not have to update each tile by hand. Hover or tap a line to see what it does."
          />
        </div>
        {/* The map takes more of a wide screen than the text above it. */}
        <div className={cn(styles.wrap, styles.wrapWide)}>
          <ModuleMap />
        </div>
      </section>

      <div id="modules">
        <StoryPlayer stories={HOUSEHOLD_STORIES} eager />
      </div>

      <section id="layouts" className={styles.section} aria-labelledby="layouts-title">
        <div className={styles.wrap}>
          <SectionHead id="layouts" title="One app, laid out for the screen" lede="The same household and the same data on every phone in the house and on the computer. The layout changes with the width of the screen." />
          <div className={styles.layouts}>
            <div className={styles.layoutsShots}>
              <div className={styles.browser}>
                <div className={styles.browserBar} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className={styles.browserScreen}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={desktopScreenSrc("home")} alt={DESKTOP_ALT.home} width={1440} height={900} loading="lazy" decoding="async" className={cn(styles.frame, styles.frameOn)} />
                </div>
              </div>
              <div className={cn(styles.phone, styles.layoutsPhone)}>
                <div className={styles.phoneScreen}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={screenSrc("home")} alt={SCREEN_ALT.home} width={390} height={844} loading="lazy" decoding="async" className={cn(styles.frame, styles.frameOn)} />
                </div>
              </div>
            </div>
            <ul className={styles.layoutsList}>
              {LAYOUT_FACTS.map((f) => (
                <li key={f.title}>
                  <b>{f.title}.</b> {f.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="e-ink" className={styles.section} aria-labelledby="e-ink-title">
        <div className={styles.wrap}>
          <div className={styles.einkFrame}>
            <div className={styles.einkMat}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={einkScreenSrc("home")} alt={EINK_ALT} width={EINK_W} height={EINK_H} loading="lazy" decoding="async" />
            </div>
          </div>
          <div className={styles.einkCopy}>
            <SectionHead id="e-ink" title="Leave it on the wall" lede="Put Rooftap on an e-paper tablet or frame by the door. The household's day stays on screen, sharp and still." />
            <ul className={styles.layoutsList}>
              {EINK_FACTS.map((f) => (
                <li key={f.title}>
                  <b>{f.title}.</b> {f.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="compare" className={styles.section} aria-labelledby="compare-title">
        <div className={styles.wrap}>
          <SectionHead id="compare" title="One app, not eight" />
          <div className={styles.compareWrap}>
            <table className={styles.compare}>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Usually</th>
                  <th scope="col">In Rooftap</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([job, separate, homeup]) => (
                  <tr key={job}>
                    <th scope="row">{job}</th>
                    <td>{separate}</td>
                    <td>{homeup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="price" className={styles.section} aria-labelledby="price-title">
        <div className={styles.wrap}>
          <SectionHead
            id="price"
            title="Free during the beta"
            lede="The hosted app costs nothing while Rooftap is in beta. The Assistant comes with the Plus plan, which is not on sale yet. On your own server everything is free, the Assistant too."
          />
          <div className={cn(styles.heroCtaMain, styles.ctaOne)}>
            <a href={WEB_APP_URL} className={styles.button}>
              Use the app
            </a>
          </div>
        </div>
      </section>

      <section id="faq" className={styles.section} aria-labelledby="faq-title">
        <div className={styles.wrap}>
          <SectionHead id="faq" title="Questions" />
          <Faq items={HOUSEHOLD_FAQ} />
        </div>
      </section>
    </LandingShell>
  );
}
