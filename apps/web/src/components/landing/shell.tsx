"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";
import { SignIn, SignInHref } from "./sign-in";

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
export function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export interface ShellLink {
  label: string;
  href: string;
}

/**
 * The frame both public pages share: the top bar, the footer, and the Ember
 * Night theme the site is always shown in.
 */
export function LandingShell({
  signInHref,
  nav,
  navStart,
  footerLinks,
  footerLine,
  children,
}: {
  signInHref: string | null;
  /** The top bar's links, before Sign in. */
  nav: readonly ShellLink[];
  /** Anything before the links, such as a menu. */
  navStart?: ReactNode;
  footerLinks: readonly ShellLink[];
  /** The line under the wordmark in the footer. */
  footerLine: string;
  children: ReactNode;
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
              {navStart}
              {nav.map((l) => (
                <a key={l.href} href={l.href} className={styles.navLink}>
                  {l.label}
                </a>
              ))}
              <SignIn />
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className={styles.footer}>
          <div className={cn(styles.wrap, styles.footerInner)}>
            <div className={styles.footerBrand}>
              <span className={styles.wordmark}>Rooftap</span>
              <p>{footerLine}</p>
            </div>
            <nav className={styles.footerLinks} aria-label="Footer">
              {footerLinks.map((l) => (
                <a key={l.href} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
        </footer>
      </div>
    </SignInHref.Provider>
  );
}

/** A section's title and lede, the same on every section of both pages. */
export function SectionHead({ id, title, lede }: { id: string; title: string; lede?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={`${id}-title`} className={cn(styles.display, styles.sectionTitle)}>
        {title}
      </h2>
      {lede && <p className={styles.sectionLede}>{lede}</p>}
    </div>
  );
}

/** A plain list of questions and answers. */
export function Faq({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className={styles.faq}>
      {items.map(([q, a]) => (
        <div key={q}>
          <dt>{q}</dt>
          <dd>{a}</dd>
        </div>
      ))}
    </dl>
  );
}
