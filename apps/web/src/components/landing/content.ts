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
  ["Assistant.", "The household assistant runs in the same app, with the model you pick, and answers on your own Telegram bot."],
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
      ["Capture", "one + adds anything to any module, and finds what is already there"],
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
    section: "shopper",
    name: "Shopper",
    items: [
      ["Watchlist", "the things the house wants to buy"],
      ["Deal rating", "great, good, fair or above usual, from 90 days of prices"],
      ["Target price", "the row says when a store reaches it"],
      ["Price history", "a daily low per item, on your server"],
      ["Every store", "price, distance and stock"],
      ["Price sources", "pluggable per region, and open to new ones"],
      ["Plan to buy", "a to-do in Tasks and a planned cost in Costs"],
      ["Scout", "up to three AI picks for a brief, each with its reason, and follow-up questions"],
    ],
  },
  {
    section: "rewards",
    name: "Rewards",
    items: [
      ["Card wallet", "loyalty cards and memberships, shared or just yours"],
      ["Store lookup", "type a store, see which card works there"],
      ["Partner stores", "many per scheme, from a starter list or a pasted list"],
      ["Perks", "the ones that end soon first"],
      ["Expiry", "when a membership runs out"],
    ],
  },
  {
    section: "assistant",
    name: "Assistant",
    items: [
      ["Quick asks", "close 30 minutes after the last message"],
      ["Named chats", "kept and pinned"],
      ["Household thread", "one thread the whole house shares"],
      ["Trust per module", "read, ask first or act"],
      ["Any model", "a cloud key or a local model"],
      ["Spending", "a budget per household and per person"],
      ["Telegram", "your own bot, history in the app"],
      ["Home Assistant", "lights, locks and climate, through its MCP Server"],
      ["Memory", "facts the household can read and remove"],
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

/** The Assistant on a self-hosted server (.docs/self-hosting.md, "The household assistant"). */
export const ASSISTANT_ENV: readonly string[] = [
  "# .env: a local model in Ollama",
  "ASSISTANT_PROVIDER=compatible",
  "ASSISTANT_BASE_URL=http://ollama:11434/v1",
  "ASSISTANT_MODEL=llama3.1:8b",
  "# your own bot, from @BotFather",
  "TELEGRAM_BOT_TOKEN=...",
  "TELEGRAM_WEBHOOK_SECRET=...",
  "",
  "docker compose --profile telegram up -d",
];

export const ASSISTANT_FACTS: ReadonlyArray<[string, string]> = [
  ["Any model.", "A key for Gemini, OpenAI, Anthropic or OpenRouter, or a local model in Ollama or LM Studio. With a local model, no prompt leaves your network."],
  ["Your Telegram bot.", "The poller runs in Docker and needs no open ports. Each person links an account with a code. The history stays in your database."],
  ["Trust per module.", "Read, Ask first or Act. A delete always asks. Changes under Ask first wait for a tap in the app or on Telegram."],
  ["No caps.", "A self-hosted server has no plan and no spending limit unless an owner sets a budget."],
  ["Spending.", "A household budget, a limit per person, and usage by person, by feature and by model."],
  ["Home Assistant.", "Connect Home Assistant's MCP Server with a long-lived token. The assistant reads and controls what you expose to Assist, under one trust level and a switch per tool."],
  ["Hosted.", "On the hosted service the Assistant needs the Plus plan. Plus is not on sale yet."],
];

export const FAQ: ReadonlyArray<[question: string, answer: string]> = [
  ["Where is my data?", "On a server you run, in its Postgres database, when you self-host. Nothing leaves it unless you turn on an add-on such as Google Calendar sync."],
  ["What does it cost?", "Self-hosting is free. Hosted plans come later."],
  ["Which platforms?", "A web app you can install on any OS as a PWA, and a native Android app. A native iOS app is coming soon."],
  ["Does it work offline?", "The Android app reads without a connection and syncs your changes when it is back online."],
  ["Do I need a Google account?", "No. Google sign-in and Google Calendar sync are optional."],
  ["What is the licence?", "The Elastic License 2.0. You can read the source, run it and change it for your own household. You cannot offer it to others as a hosted service."],
  ["Can my AI assistant use it?", "Yes. Rooftap has an MCP server. Each key can be read-only, limited to some tools, and set to expire."],
  ["Is the Assistant free?", "On a self-hosted server, yes. You bring a model key or run a local model. On the hosted service the Assistant needs the Plus plan, which is not on sale yet."],
  ["Does the Assistant change things without asking?", "Only where an owner sets a module to Act. The default is Ask first: each change waits for a tap. A delete always asks."],
  ["Does it work with Home Assistant?", "Yes. The Assistant connects to Home Assistant's MCP Server integration with a long-lived token. It sees and controls only the devices you expose to Assist. A self-hosted server can reach Home Assistant on your LAN."],
  ["Where do Shopper prices come from?", "From the sources your server has for its region. An AU server ships with Google Shopping via SerpApi, OpenStreetMap and OzBargain. You can add a price by hand, or write a source."],
];

/** The hosted web app, and the Android APKs on the public repo's Releases page. */
export const WEB_APP_URL = "https://homeup.vercel.app";
export const REPO_URL = "https://github.com/guybnd/rooftap";
export const APK_URL = `${REPO_URL}/releases`;

export const LICENCE_URL = "https://www.elastic.co/licensing/elastic-license";

/** One household's jobs: the separate app each one usually needs, and what Rooftap does instead. */
export const COMPARE: ReadonlyArray<[job: string, separate: string, homeup: string]> = [
  ["Shopping list", "A list app", "Groceries, sorted by aisle. The trip logs itself in Costs."],
  ["Chores", "A to-do app", "Tasks with repeats, names and comments."],
  ["Family calendar", "A calendar app", "Calendar, with dated tasks and checklists in it. Two-way Google sync."],
  ["Budget", "A spreadsheet", "Costs, filled by grocery trips, event tickets and contracts."],
  ["Warranties and leases", "A drive folder", "Documents that remind you before they expire."],
  ["Recipes", "A notes app", "Recipes that know what is in the house and fill the list."],
  ["Price tracking", "A price tracker site", "Shopper, with a deal rating and a price history on your server."],
  ["Loyalty cards", "A wallet app", "Rewards, with the stores each card works at and the perks that end soon."],
  ["An AI for the house", "A chatbot with no access", "The Assistant, with your tasks, calendar, budget, list and Home Assistant. In the app or on Telegram."],
  ["Where the data lives", "Each app's own servers", "One Postgres database, on your server."],
];

/** The E-Ink theme on an always-on screen. */
export const EINK_FACTS: readonly { title: string; text: string }[] = [
  { title: "Flat greys", text: "No glow, shadow or colour wash. Text stays sharp on e-paper." },
  { title: "No motion", text: "Pages change at once, so the screen does not ghost." },
  { title: "Same data", text: "It is the same app, so a tick on a phone shows on the wall." },
  { title: "One setting", text: "Settings, then Appearance, then E-Ink. It works on the web app and the Android app." },
];

/** One app, two layouts: what each screen size gets. */
export const LAYOUT_FACTS: readonly { title: string; text: string }[] = [
  { title: "Phone layout", text: "On a phone or a narrow window, you get one column, a tab bar, swipes and press-and-hold. The Android app uses this layout too." },
  { title: "Desktop layout", text: "On a screen 1024 pixels wide or more, a top bar replaces the tab bar. Upcoming becomes a week board with the weather for each day." },
  { title: "Your Home grid", text: "Drag the Home modules into place and change their size. Each browser keeps its own arrangement." },
  { title: "Mouse and keyboard", text: "Right-click any row for its actions. Double-click a day on the board to add a to-do, an event, a checklist or a cost to it." },
  { title: "Your choice", text: "Settings, then Appearance, switches a wide screen back to the classic sidebar layout." },
];
