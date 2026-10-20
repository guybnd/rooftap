// The landing page's plain sections: the self-host steps, every feature by
// module, and the FAQ. Each claim exists in the app (packages/core
// module-features.ts names the cross-module links). Licence: Elastic 2.0,
// never "open source". Platforms: a web app (PWA) for every OS, native Android, native iOS coming soon.

/** Self-hosting in three steps (.docs/self-hosting.md). */
export const SELF_HOST_STEPS: ReadonlyArray<{ title: string; text: string; code?: readonly string[] }> = [
  { title: "Install Docker", text: "Docker Engine with Compose, on a server, a NAS or a small board computer." },
  {
    title: "Run the script",
    text: "It generates the secrets on first boot and starts the stack.",
    code: ["git clone https://github.com/guybnd/rooftap", "cd rooftap && cp .env.example .env", "./scripts/self-host-init.sh -d"],
  },
  { title: "Open the app", text: "Open port 3000 in a browser and create the first account. The Android app asks for your server address on first run." },
];

/** What one server gives you. */
export const SELF_HOST_FACTS: ReadonlyArray<[string, string]> = [
  ["Stack.", "Next.js app, Postgres, auth, file storage and realtime, as Docker containers on your own machine. No cloud account."],
  ["Modules.", "HOMEUP_MODULES lists the modules your server offers. The rest are not served."],
  ["Clients.", "The web app, and the Android app (APK). Both point at your server."],
  ["MCP.", "The MCP server runs on your machine. Your assistant talks to it, not to us."],
  ["Google optional.", "Sign-in with Google and Calendar sync are add-ons. Everything else works without them."],
  ["Price.", "Free to self-host. Hosted plans come later."],
];

export interface FeatureGroup {
  /** A section id, for the tile and its hue. */
  section: string;
  name: string;
  items: ReadonlyArray<[name: string, text: string]>;
}

/** The hero's small print: one line each, wrapping only between facts. */
export const HERO_FACTS: readonly (readonly string[])[] = [
  ["Web app (PWA) for every OS", "Native Android", "Native iOS coming soon"],
  ["Free to self-host", "Elastic License 2.0"],
];

/** Every feature, by module. */
export const FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    section: "home",
    name: "Everywhere",
    items: [
      ["Shared household", "everyone sees each change as it happens"],
      ["Every platform", "a web app (PWA) on any OS, native Android, native iOS coming soon"],
      ["Offline", "reads work without a connection, writes sync after"],
      ["Capture", "one + adds anything to any module"],
      ["Share sheet", "a link or a photo from any app"],
      ["Android widget", "Upcoming by day on the home screen"],
      ["Weather on Home", "the forecast and the hour the rain starts"],
      ["Modules per household", "the owner picks; each person hides the rest"],
      ["Ember Night and Day", "themes that follow the phone"],
      ["Haptics", "a pulse on every tick, swipe and commit"],
    ],
  },
  {
    section: "household",
    name: "Tasks",
    items: [
      ["Assignments", "a name on every chore"],
      ["Repeats", "chores on your schedule"],
      ["Snooze and priority", "later, or first"],
      ["Comments", "a thread on a task"],
      ["Checklist on a task", "the meter fills as it is ticked"],
      ["Notifications", "when a task is yours, due, or commented on"],
    ],
  },
  {
    section: "groceries",
    name: "Groceries",
    items: [
      ["Aisles you name", "sorted in the order of your shop"],
      ["Shelf life", "offered again before it runs low"],
      ["Essentials", "the things the house never runs out of"],
      ["Price memory", "the last price and the lowest"],
      ["Rewards cards", "any barcode, one tap at the checkout"],
      ["Receipt scan", "the total and the store, from the photo"],
    ],
  },
  {
    section: "recipes",
    name: "Recipes",
    items: [
      ["Recipe scan", "a cookbook page becomes a recipe"],
      ["Can make now", "every ingredient is in the house"],
      ["Add missing", "on the grocery list, in their aisles"],
    ],
  },
  {
    section: "calendar",
    name: "Calendar",
    items: [
      ["Google Calendar", "two-way sync, per person"],
      ["Event from a link", "a page, a ticket photo or a calendar file"],
      ["Leave-by pushes", "from travel time and weather"],
      ["Dated items", "tasks and checklists appear by themselves"],
    ],
  },
  {
    section: "costs",
    name: "Bills and costs",
    items: [
      ["Budget and projection", "the plan, the spend and the year in one chart"],
      ["Who pays", "split bills between the people in the house"],
      ["Contract reminders", "before an insurance or a gym contract ends"],
      ["Lease notice", "before the notice period on your lease"],
    ],
  },
  {
    section: "documents",
    name: "Documents",
    items: [
      ["Documents with dates", "a reminder before a warranty expires"],
      ["Document forms", "warranty, insurance, vehicle and lease"],
      ["Attachments", "on a bill, an event, a trip or a recipe"],
    ],
  },
  {
    section: "checklists",
    name: "Checklists",
    items: [
      ["Templates", "start a list from a template"],
      ["Dated lists", "a to-do in Tasks on the day"],
      ["Log purchases", "each ticked item can write a cost"],
    ],
  },
  {
    section: "search",
    name: "Moving house",
    items: [
      ["Home search", "paste a listing link; a map with shops and transport"],
      ["Viewings", "checklists and dealbreakers"],
      ["Home setup", "a buy list for every room of the new place"],
    ],
  },
  {
    section: "profile",
    name: "For your assistant",
    items: [
      ["MCP server", "read-only mode and a tool picker per key"],
      ["API keys", "with an expiry you choose"],
      ["Self-hosting", "one script, Docker, your modules"],
    ],
  },
];

export const FAQ: ReadonlyArray<[question: string, answer: string]> = [
  ["Where is my data?", "On a server you run, in its Postgres database, when you self-host. Nothing leaves it unless you turn on an add-on such as Google Calendar sync."],
  ["What does it cost?", "Self-hosting is free. Hosted plans come later."],
  ["Which platforms?", "A web app you can install on any OS as a PWA, and a native Android app. A native iOS app is coming soon."],
  ["Does it work offline?", "The Android app reads without a connection and syncs your changes when it is back online."],
  ["Do I need a Google account?", "No. Google sign-in and Google Calendar sync are optional."],
  ["What is the licence?", "The Elastic License 2.0. You can read the source, run it and change it for your own household. You cannot offer it to others as a hosted service."],
  ["Can my AI assistant use it?", "Yes. Rooftap has an MCP server. Each key can be read-only, limited to some tools, and set to expire."],
];

export const LICENCE_URL = "https://www.elastic.co/licensing/elastic-license";

/** One household's jobs: the separate app each one usually needs, and what Rooftap does instead. */
export const COMPARE: ReadonlyArray<[job: string, separate: string, homeup: string]> = [
  ["Shopping list", "A list app", "Groceries, sorted by aisle. The trip logs itself in Costs."],
  ["Chores", "A to-do app", "Tasks with repeats, names and comments."],
  ["Family calendar", "A calendar app", "Calendar, with dated tasks and checklists in it. Two-way Google sync."],
  ["Budget", "A spreadsheet", "Costs, filled by grocery trips, event tickets and contracts."],
  ["Warranties and leases", "A drive folder", "Documents that remind you before they expire."],
  ["Recipes", "A notes app", "Recipes that know what is in the house and fill the list."],
  ["Where the data lives", "Each app's own servers", "One Postgres database, on your server."],
];
