"use client";

import { Fragment, useEffect, useRef, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { AskPanel } from "./ask";
import { SectionTile } from "./cards";
import { APK_URL, ASSISTANT_ENV, ASSISTANT_FACTS, COMPARE, FAQ, HERO_FACTS, FEATURE_GROUPS, EINK_FACTS, LAYOUT_FACTS, LICENCE_URL, REPO_URL, SELF_HOST_FACTS, SELF_HOST_STEPS, WEB_APP_URL } from "./content";
import { HeroPhone } from "./hero-phone";
import { ModuleMap } from "./module-map";
import { DESKTOP_ALT, EINK_ALT, EINK_H, EINK_W, SCREEN_ALT, desktopScreenSrc, einkScreenSrc, screenSrc } from "./screens";
import styles from "./landing.module.css";
import { SignIn, SignInHref } from "./sign-in";
import { HERO_STORIES, ROOM_STORIES } from "./stories";
import { StoryPlayer, storyAnchor } from "./story-player";

/**
 * Without JavaScript the story stages cannot play, so each one becomes a
 * plain column: every caption shown in turn, the first phone beside them.
 * Crawlers read the same text either way.
 */
const NO_SCRIPT_CSS = `
.${styles.run}{height:auto!important}
.${styles.stage}{position:relative;height:auto;overflow:visible;padding-block:96px}
.${styles.stageInner}{align-items:start}
.${styles.captions}{gap:48px}
.${styles.caption}{grid-area:auto;opacity:1;transform:none}
.${styles.steps},.${styles.lines}{display:none}
`;

/** GitHub's mark, for the repository link. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/** Closes the Modules menu once a module is picked. */
function closeMenuOnPick(e: MouseEvent<HTMLDetailsElement>) {
  if ((e.target as Element).closest("a")) e.currentTarget.open = false;
}

export function LandingPage({
  signInHref = "/login",
  privacyHref = "/privacy",
  demoHref = null,
}: {
  signInHref?: string | null;
  privacyHref?: string;
  /** The live demo's address. Only the static site builds the demo. */
  demoHref?: string | null;
}) {
  // A tap anywhere outside the open Modules menu closes it.
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
    <SignInHref.Provider value={signInHref}>
      {/* Always Ember Night: the page is presented at night whatever the device's theme. */}
      <div className={cn(styles.page, "dark")} data-theme="ember-night" data-hue="coral">
        <noscript dangerouslySetInnerHTML={{ __html: `<style>${NO_SCRIPT_CSS}</style>` }} />
        <header className={styles.nav}>
          <div className={cn(styles.wrap, styles.navInner)}>
            <a href="#top" className={styles.wordmark}>
              Rooftap
            </a>
            <nav className={styles.navLinks} aria-label="Page">
              <details ref={menuRef} className={styles.navMenu} onClick={closeMenuOnPick}>
                <summary className={styles.navLink}>Modules</summary>
                <div className={styles.navMenuList}>
                  {[...HERO_STORIES, ...ROOM_STORIES].map((story) => (
                    <a key={story.id} href={`#${storyAnchor(story)}`}>
                      <SectionTile sectionId={story.room} small />
                      {story.eyebrow}
                    </a>
                  ))}
                </div>
              </details>
              <a href="#self-host" className={styles.navLink}>
                Self-host
              </a>
              <a href="#assistant" className={styles.navLink}>
                Assistant
              </a>
              <a href="#features" className={styles.navLink}>
                Features
              </a>
              <a href="#faq" className={styles.navLink}>
                FAQ
              </a>
              <SignIn />
            </nav>
          </div>
        </header>

        <main>
          <section id="top" className={styles.hero} aria-labelledby="hero-title">
            <div className={cn(styles.wrap, styles.heroInner)}>
              <div className={styles.heroText}>
                <p className={styles.eyebrow}>Household management you can host</p>
                <h1 id="hero-title" className={cn(styles.display, styles.heroTitle)}>
                  Your home, your server.
                </h1>
                <p className={styles.sectionLede}>
                  One shared app for the tasks, groceries, costs, calendar, recipes, documents, checklists and shopping of a household. Everyone in the house sees each change as it happens.
                </p>
                <p className={styles.sectionLede}>
                  Run it on a machine you own with one script. The web app and the Android app point at your server. A household assistant runs there too, with your model and your Telegram bot.
                </p>
                {/* Two labelled pairs of equal buttons: host it, or try it first. */}
                <div className={styles.heroCtas}>
                  <span className={styles.heroCtaLabel}>Host it</span>
                  <a href="#self-host" className={styles.button}>
                    Run your own
                  </a>
                  <a href={REPO_URL} className={styles.ghost}>
                    <GitHubMark />
                    View on GitHub
                  </a>
                  <span className={styles.heroCtaLabel}>Try it</span>
                  <a href={WEB_APP_URL} className={styles.ghost}>
                    Open the web app
                  </a>
                  <a href={APK_URL} className={styles.ghost}>
                    Android APK
                  </a>
                </div>
                <p className={styles.heroFacts}>
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
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Connected modules</p>
                <h2 id="fits-title" className={cn(styles.display, styles.sectionTitle)}>
                  Dynamic and interconnected
                </h2>
                <p className={styles.sectionLede}>
                  Most actions do more than one thing. Plan to buy a TV and you get a to-do and a line in the budget. Finish a shopping trip and its total goes to Costs. You do not have to update each module by hand. Hover or tap a line to see what it does.
                </p>
              </div>
            </div>
            {/* The map takes more of a wide screen than the text above it. */}
            <div className={cn(styles.wrap, styles.wrapWide)}>
              <ModuleMap />
            </div>
          </section>

          <div id="modules">
            <StoryPlayer stories={HERO_STORIES} eager />
            <StoryPlayer stories={ROOM_STORIES} />
          </div>

          <section id="layouts" className={styles.section} aria-labelledby="layouts-title">
            <div className={styles.wrap}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Phone, tablet and desktop</p>
                <h2 id="layouts-title" className={cn(styles.display, styles.sectionTitle)}>
                  One app, laid out for the screen
                </h2>
                <p className={styles.sectionLede}>The same household and the same data. The layout changes with the width of the screen.</p>
              </div>
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
                <div className={styles.sectionHead}>
                  <p className={styles.eyebrow}>E-Ink theme</p>
                  <h2 id="e-ink-title" className={cn(styles.display, styles.sectionTitle)}>
                    Leave it on the wall
                  </h2>
                  <p className={styles.sectionLede}>Put Rooftap on an e-paper tablet or frame by the door. The household&apos;s day stays on screen, sharp and still.</p>
                </div>
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
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Instead of</p>
                <h2 id="compare-title" className={cn(styles.display, styles.sectionTitle)}>
                  One app, not eight
                </h2>
              </div>
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

          <section id="assistant" className={styles.section} aria-labelledby="assistant-title">
            <div className={cn(styles.wrap, styles.split)}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Self-hosted assistant</p>
                <h2 id="assistant-title" className={cn(styles.display, styles.sectionTitle)}>
                  An assistant on your own server
                </h2>
                <p className={styles.sectionLede}>
                  The Assistant module runs inside your Rooftap server. It reads and, with your OK, changes your tasks, calendar, budget, groceries, recipes and lists. Pick the model. Talk to it in the app or through your own Telegram bot.
                </p>
                <pre className={styles.code}>
                  <code>{ASSISTANT_ENV.join("\n")}</code>
                </pre>
              </div>
              <dl className={cn(styles.hostFacts, styles.assistantFacts)}>
                {ASSISTANT_FACTS.map(([name, text]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section id="mcp" className={styles.section} aria-labelledby="mcp-title">
            <div className={cn(styles.wrap, styles.split)}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>MCP server</p>
                <h2 id="mcp-title" className={cn(styles.display, styles.sectionTitle)}>
                  Ask your assistant
                </h2>
                <p className={styles.sectionLede}>
                  Connect Claude or any MCP client with a key. It reads and writes groceries, tasks, calendar events and costs. Each key can be read-only, limited to some tools, and set to expire.
                </p>
              </div>
              <AskPanel />
            </div>
          </section>

          <section id="self-host" className={cn(styles.section, styles.selfHostSection)} aria-labelledby="self-host-title">
            <div className={styles.wrap}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Self-hosting</p>
                <h2 id="self-host-title" className={cn(styles.display, styles.sectionTitle)}>
                  Run your own server
                </h2>
                <p className={styles.sectionLede}>All modules for one household in one Postgres database, in Docker on a machine you own.</p>
              </div>
              <ol className={styles.hostSteps}>
                {SELF_HOST_STEPS.map((s, i) => (
                  <li key={s.title} className={styles.hostStep}>
                    <span className={styles.hostStepNum} aria-hidden="true">
                      {i + 1}
                    </span>
                    <h3 className={styles.hostStepTitle}>{s.title}</h3>
                    <p>{s.text}</p>
                    {s.code && (
                      <pre className={styles.code}>
                        <code>{s.code.join("\n")}</code>
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
              <dl className={styles.hostFacts}>
                {SELF_HOST_FACTS.map(([name, text]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section id="features" className={styles.section} aria-labelledby="features-title">
            <div className={styles.wrap}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Feature list</p>
                <h2 id="features-title" className={cn(styles.display, styles.sectionTitle)}>
                  Every feature
                </h2>
              </div>
              <details className={styles.featureDetails}>
                <summary className={styles.ghost}>Show all {FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0)} features</summary>
                <div className={styles.featureGrid}>
                  {FEATURE_GROUPS.map((g) => (
                    <article key={g.name} className={styles.featureGroup}>
                      <div className={styles.featureGroupHead}>
                        <SectionTile sectionId={g.section} small />
                        <h3>{g.name}</h3>
                      </div>
                      <ul>
                        {g.items.map(([name, text]) => (
                          <li key={name}>
                            <b>{name}</b>
                            <span>{text}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </details>
            </div>
          </section>

          <section id="faq" className={styles.section} aria-labelledby="faq-title">
            <div className={styles.wrap}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>FAQ</p>
                <h2 id="faq-title" className={cn(styles.display, styles.sectionTitle)}>
                  Questions
                </h2>
              </div>
              <dl className={styles.faq}>
                {FAQ.map(([q, a]) => (
                  <div key={q}>
                    <dt>{q}</dt>
                    <dd>{a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={cn(styles.wrap, styles.footerInner)}>
            <div className={styles.footerBrand}>
              <span className={styles.wordmark}>Rooftap</span>
              <p>One shared app for a household, on a server you own.</p>
            </div>
            <nav className={styles.footerLinks} aria-label="Footer">
              <a href="#modules">Modules</a>
              <a href="#self-host">Self-host</a>
              <a href="#assistant">Assistant</a>
              <a href="#features">Every feature</a>
              <a href="#faq">FAQ</a>
              <a href={privacyHref}>Privacy</a>
              <a href={LICENCE_URL}>Licence: Elastic License 2.0</a>
            </nav>
          </div>
        </footer>
      </div>
    </SignInHref.Provider>
  );
}
