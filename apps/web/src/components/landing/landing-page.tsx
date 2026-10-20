"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { AskPanel } from "./ask";
import { SectionTile } from "./cards";
import { COMPARE, FAQ, HERO_FACTS, FEATURE_GROUPS, LICENCE_URL, SELF_HOST_FACTS, SELF_HOST_STEPS } from "./content";
import { Fits } from "./fits";
import { HeroPhone } from "./hero-phone";
import styles from "./landing.module.css";
import { SignIn, SignInHref } from "./sign-in";
import { HERO_STORIES, ROOM_STORIES } from "./stories";
import { StoryPlayer } from "./story-player";

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
              <a href="#modules" className={styles.navLink}>
                Modules
              </a>
              <a href="#self-host" className={styles.navLink}>
                Self-host
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
                  One shared app for the tasks, groceries, costs, calendar, recipes, documents and checklists of a household. Everyone in the house sees each change as it happens.
                </p>
                <p className={styles.sectionLede}>Run it on a machine you own with one script. The web app and the Android app point at your server.</p>
                <div className={styles.ctaRow}>
                  <a href="#self-host" className={styles.button}>
                    Run your own
                  </a>
                  <a href="#modules" className={styles.ghost}>
                    See the modules
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

          <div id="modules">
            <StoryPlayer stories={HERO_STORIES} eager />
            <StoryPlayer stories={ROOM_STORIES} />
          </div>

          <section id="fits" className={styles.section} aria-labelledby="fits-title">
            <div className={styles.wrap}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Connected modules</p>
                <h2 id="fits-title" className={cn(styles.display, styles.sectionTitle)}>
                  One module fills the next
                </h2>
                <p className={styles.sectionLede}>You enter a thing once. The modules after it pick it up.</p>
              </div>
              <Fits />
            </div>
          </section>

          <section id="compare" className={styles.section} aria-labelledby="compare-title">
            <div className={styles.wrap}>
              <div className={styles.sectionHead}>
                <p className={styles.eyebrow}>Instead of</p>
                <h2 id="compare-title" className={cn(styles.display, styles.sectionTitle)}>
                  One app, not six
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
                <p className={styles.eyebrow}>MCP server</p>
                <h2 id="assistant-title" className={cn(styles.display, styles.sectionTitle)}>
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
