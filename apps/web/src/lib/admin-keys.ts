export interface KeyDefinition {
  key: string;
  class: "runtime" | "build-time";
  label: string;
  purpose: string;
}

export const RUNTIME_KEYS: KeyDefinition[] = [
  {
    key: "OPENAI_API_KEY",
    class: "runtime",
    label: "OpenAI API key",
    purpose: "Parses listings, receipts, and recipes from photos or pasted text (default parsing provider).",
  },
  {
    key: "GEMINI_API_KEY",
    class: "runtime",
    label: "Gemini API key",
    purpose: "Parses recipes from photos (default provider for recipes).",
  },
  {
    key: "OPENROUTER_API_KEY",
    class: "runtime",
    label: "OpenRouter API key",
    purpose: "Alternate parsing provider for listings, receipts, and recipes.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    class: "runtime",
    label: "Anthropic API key",
    purpose: "Alternate parsing provider for listings, receipts, and recipes.",
  },
  {
    key: "SCRAPER_API_KEY",
    class: "runtime",
    label: "ScraperAPI key",
    purpose: "Fetches listing pages that block direct requests.",
  },
  {
    key: "GOOGLE_CLIENT_ID",
    class: "runtime",
    label: "Google Calendar OAuth",
    purpose: "Refreshes access tokens for connected Google Calendars.",
  },
];

export const BUILD_TIME_KEYS: KeyDefinition[] = [
  {
    key: "NEXT_PUBLIC_MAPBOX_TOKEN",
    class: "build-time",
    label: "Mapbox token",
    purpose: "Renders maps in listings, itineraries, and the setup checklist.",
  },
  {
    key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    class: "build-time",
    label: "Push notification VAPID key",
    purpose: "Identifies this app to browsers when sending push notifications.",
  },
];

// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are one logical row in the UI/GET
// response (a single OAuth pair), but both are stored and PUT independently.
// Exported so the test route (src/app/api/admin/keys/test/route.ts) validates
// against the same known-key sets rather than duplicating them.
export const RUNTIME_KEY_NAMES = new Set([
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "SCRAPER_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
]);
export const BUILD_TIME_KEY_NAMES = new Set(BUILD_TIME_KEYS.map((k) => k.key));
