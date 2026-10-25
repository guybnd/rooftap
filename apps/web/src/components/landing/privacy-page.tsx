import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

// The privacy page. Facts only: each provider named here is one the code
// calls (apps/web/src/app/api, supabase/functions). Keep it in step with
// them when a provider is added or removed.

const SECTIONS: ReadonlyArray<[title: string, paragraphs: readonly string[]]> = [
  [
    "Self-hosted servers",
    [
      "When you run Rooftap on your own machine, your data stays in that machine's database and file storage. We do not receive it.",
      "The add-ons below send data to their providers only when you turn them on.",
    ],
  ],
  [
    "What the app stores",
    [
      "Your account: your name, your email address and how you sign in.",
      "Your household's data: the tasks, groceries, costs, events, recipes, documents and checklists that you enter, and the files you upload.",
      "On Android, a push token, so the app can send you notifications.",
    ],
  ],
  [
    "Providers the app calls",
    [
      "Google: sign-in with Google and Google Calendar sync, when you connect them.",
      "Open-Meteo: the weather on Home. It receives the location of your household.",
      "Mapbox: maps and travel times. It receives the addresses on a listing or an event.",
      "An AI provider chosen by the server owner: receipt, recipe, document and listing scans. It receives the photo or the page that you scan.",
      "ScraperAPI: reads a listing page when you paste a listing link.",
      "Expo: delivers push notifications to Android.",
    ],
  ],
  [
    "The hosted service",
    ["The hosted service keeps its database and files with Supabase and serves the web app from Vercel."],
  ],
  [
    "What the app does not do",
    ["No advertising. No analytics or tracking scripts. No sale of data."],
  ],
];

export function PrivacyPage({ homeHref = "/" }: { homeHref?: string }) {
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
            <h1 className={cn(styles.display, styles.sectionTitle)}>Privacy</h1>
            <p className={styles.sectionLede}>This page covers the Rooftap app: the hosted service and the software that you run yourself. Last updated 19 October 2026.</p>
          </div>
          {SECTIONS.map(([title, paragraphs]) => (
            <section key={title} className={styles.legalSection}>
              <h2>{title}</h2>
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
