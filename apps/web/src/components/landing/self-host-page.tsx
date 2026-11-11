"use client";

import { cn } from "@/lib/utils";
import { AskPanel } from "./ask";
import { SectionTile } from "./cards";
import { APK_URL, ASSISTANT_ENV, ASSISTANT_FACTS, FEATURE_GROUPS, LICENCE_URL, REPO_URL, SELF_HOST_FACTS, SELF_HOST_FAQ, SELF_HOST_STEPS } from "./content";
import { DESKTOP_ALT, desktopScreenSrc } from "./screens";
import { Faq, GitHubMark, LandingShell, SectionHead } from "./shell";
import styles from "./landing.module.css";

/**
 * The page for people who run their own server: install, the stack, the
 * Assistant's setup, MCP, every feature and the licence. The household page
 * (landing-page.tsx) links here and keeps none of it.
 */
export function SelfHostPage({
  signInHref = "/login",
  homeHref = "/",
  privacyHref = "/privacy",
  demoHref = null,
}: {
  signInHref?: string | null;
  /** The household page. */
  homeHref?: string;
  privacyHref?: string;
  /** The live demo's address. Only the static site builds the demo. */
  demoHref?: string | null;
}) {
  return (
    <LandingShell
      signInHref={signInHref}
      nav={[
        { label: "Install", href: "#install" },
        { label: "Assistant", href: "#assistant" },
        { label: "MCP", href: "#mcp" },
        { label: "FAQ", href: "#faq" },
        { label: "For households", href: homeHref },
      ]}
      footerLinks={[
        { label: "For households", href: homeHref },
        { label: "Install", href: "#install" },
        { label: "Every feature", href: "#features" },
        { label: "Privacy", href: privacyHref },
        { label: "Licence: Elastic License 2.0", href: LICENCE_URL },
      ]}
      footerLine="One shared app for a household, on a server you own."
    >
      <section id="top" className={styles.hero} aria-labelledby="hero-title">
        <div className={cn(styles.wrap, styles.heroInner)}>
          <div className={styles.heroText}>
            <h1 id="hero-title" className={cn(styles.display, styles.heroTitle)}>
              Put it under your own roof.
            </h1>
            <p className={styles.sectionLede}>Every tile for one household in one Postgres database, in Docker on a machine you own. Free to self-host.</p>
            <div className={styles.heroCtas}>
              <div className={styles.heroCtaMain}>
                <a href={REPO_URL} className={styles.buttonAlt}>
                  <GitHubMark />
                  View on GitHub
                </a>
                <a href="#install" className={styles.button}>
                  Install
                </a>
              </div>
              <div className={styles.heroCtaMore}>
                {demoHref && (
                  <a href={demoHref} className={styles.heroCtaLink}>
                    Try the live demo
                  </a>
                )}
                <a href={APK_URL} className={styles.heroCtaLink}>
                  Android app
                </a>
              </div>
            </div>
          </div>
          <div className={styles.browser}>
            <div className={styles.browserBar} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.browserScreen}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={desktopScreenSrc("home")} alt={DESKTOP_ALT.home} width={1440} height={900} decoding="async" className={cn(styles.frame, styles.frameOn)} />
            </div>
          </div>
        </div>
      </section>

      <section id="install" className={cn(styles.section, styles.selfHostSection)} aria-labelledby="install-title">
        <div className={styles.wrap}>
          <SectionHead id="install" title="Three steps" lede="One script generates the secrets and starts the stack." />
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

      <section id="assistant" className={styles.section} aria-labelledby="assistant-title">
        <div className={cn(styles.wrap, styles.split)}>
          <div>
            <SectionHead
              id="assistant"
              title="An assistant on your own server"
              lede="The Assistant module runs inside your Rooftap server. It reads and, with your OK, changes your tasks, calendar, budget, groceries, recipes and lists. Pick the model. Talk to it in the app or through your own Telegram bot."
            />
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
          <SectionHead
            id="mcp"
            title="Ask your assistant"
            lede="Connect Claude or any MCP client with a key. It reads and writes groceries, tasks, calendar events and costs. Each key can be read-only, limited to some tools, and set to expire."
          />
          <AskPanel />
        </div>
      </section>

      <section id="features" className={styles.section} aria-labelledby="features-title">
        <div className={styles.wrap}>
          <SectionHead id="features" title="Every feature" />
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
          <SectionHead id="faq" title="Questions" />
          <Faq items={SELF_HOST_FAQ} />
        </div>
      </section>
    </LandingShell>
  );
}
