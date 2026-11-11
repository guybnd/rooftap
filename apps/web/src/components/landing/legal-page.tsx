import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

// The shared layout of the public legal pages (Privacy, Terms).

export type LegalSections = ReadonlyArray<[title: string, paragraphs: readonly string[]]>;

/** Where people send privacy requests and questions about the Terms. */
export const LEGAL_CONTACT_EMAIL = "CONTACT_EMAIL_TODO";

export function LegalPage({ title, lede, sections, homeHref = "/" }: { title: string; lede: string; sections: LegalSections; homeHref?: string }) {
  return (
    <div className={cn(styles.page, "dark")} data-theme="ember-night" data-hue="coral">
      <header className={styles.nav}>
        <div className={cn(styles.wrap, styles.navInner)}>
          <a href={homeHref} className={styles.wordmark}>
            Rooftap
          </a>
        </div>
      </header>
      <main className={cn(styles.section, styles.legal)}>
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h1 className={cn(styles.display, styles.sectionTitle)}>{title}</h1>
            <p className={styles.sectionLede}>{lede}</p>
          </div>
          {sections.map(([heading, paragraphs]) => (
            <section key={heading} className={styles.legalSection}>
              <h2>{heading}</h2>
              {paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
