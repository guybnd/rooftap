import { LEGAL_CONTACT_EMAIL, LegalPage, type LegalSections } from "./legal-page";

// The privacy page. Facts only. Providers are listed by kind (AI, bank feeds,
// chat apps...), never by name, so a new connector or region fits an existing
// line. When a feature sends data to a new kind of provider (see
// apps/web/src/app/api, apps/web/src/lib, supabase/functions), add a line.
const SECTIONS: LegalSections = [
  [
    "Self-hosted servers",
    [
      "When you run Rooftap on your own machine, your data stays in that machine's database and file storage. We do not receive it.",
      "The add-ons below send data to their providers only when you turn them on. The owner of a self-hosted server is responsible for the data on it.",
    ],
  ],
  [
    "What the app stores",
    [
      "Your account: your name, your email address and how you sign in.",
      "Your household's data: the tasks, groceries, costs, events, recipes, documents and checklists that you enter, and the files you upload.",
      "Your Assistant chats, and the notes the Assistant keeps for your household.",
      "Bank data, only when you connect it: the transactions from a bank feed or from a bank statement that you import. We store the keys for a bank feed encrypted.",
      "On Android, a push token, so the app can send you notifications. In a browser or on an iPhone Home Screen, the browser's push address, when you turn notifications on.",
      "Crash reports: when a screen does not load, the app sends its server the error, the screen and the app version. Never your name, household or items. You can turn this off in Settings, About & updates. A self-hosted server passes reports on to us only if its owner chooses to.",
    ],
  ],
  [
    "Who sees your data",
    [
      "The members of your household see what you share with the household. Items you keep private, or keep from a member, stay hidden from them.",
      "We look at your data only to fix a problem that you report, or when the law requires it.",
    ],
  ],
  [
    "Providers the app calls",
    [
      "The app sends data to a provider only for the feature that needs it. These are the kinds of providers it uses.",
      "AI: scans of receipts, recipes, documents and listings, and Assistant chats. The provider receives the photo or page that you scan, and for a chat, your message and the household items the Assistant reads to answer it. The server owner picks the provider. If your household adds its own AI key, that provider receives them instead.",
      "Sign-in and calendars: when you sign in with another account, or sync a calendar.",
      "Bank feeds: your transactions, from a bank feed that you connect.",
      "Chat apps: your Assistant messages, when you link the Assistant to a chat app.",
      "Weather: the weather on Home. The provider receives the location of your household.",
      "Maps: maps and travel times. The provider receives the addresses on a listing or an event.",
      "Price checks: Shopper looks up prices with search providers. They receive the names of the items that you watch.",
      "Page reading: when you paste a listing link, a page-reading service opens the page.",
      "Notifications: push services deliver notifications to your phone or browser. They receive the notification text.",
    ],
  ],
  [
    "Where your data is kept",
    [
      "The hosted service keeps its database, files and web app with cloud hosting providers.",
      "These providers and the AI providers can store or handle data outside Australia, for example in the United States.",
    ],
  ],
  [
    "How long we keep it",
    [
      "We keep your data while your account is open.",
      "When you ask us to delete your account, we delete it within 30 days. If you are the last member of your household, we delete the household's data too. Copies in backups expire on their normal schedule.",
    ],
  ],
  [
    "Your choices",
    [
      `You can ask for a copy of your data, ask us to correct it, or ask us to delete your account. Email ${LEGAL_CONTACT_EMAIL}.`,
      "If you think that we handled your data badly, tell us first. You can also complain to the Office of the Australian Information Commissioner, or to the data protection authority where you live.",
    ],
  ],
  [
    "Children",
    ["Rooftap is for households. A child can use it only as a member of a household that a parent or guardian runs."],
  ],
  [
    "What the app does not do",
    ["No advertising. No analytics or tracking scripts. No sale of data."],
  ],
  [
    "Changes",
    ["If we change this page in a way that matters to you, we tell you in the app before the change starts."],
  ],
];

export function PrivacyPage({ homeHref = "/" }: { homeHref?: string }) {
  return (
    <LegalPage
      title="Privacy"
      lede="This page covers the Rooftap app: the hosted service and the software that you run yourself. Last updated 9 November 2026."
      sections={SECTIONS}
      homeHref={homeHref}
    />
  );
}
