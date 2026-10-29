import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULES } from "@homeup/core";

// Every API route says who may call it and which module it belongs to.
// Each route.ts under app/api must be listed below, so a new route can't
// ship without someone deciding both, and the checks below make sure the
// route's source actually does what its entry says:
// - `auth`: the guard it runs before anything else. A session route reads
//   the signed-in person (cookie on web, Bearer on the phone); `operator` and
//   `owner` are the admin gates; `pat` is a bot key; `cron` and `signed` check
//   a shared secret; `public` routes say why they need no sign-in.
// - `module`: the module that must be on for the household, or null for a
//   platform route (which then says why). The route answers 404 when its
//   module is off, through requireModules or the area helper that calls it.

type Auth = "session" | "operator" | "owner" | "pat" | "cron" | "signed" | "public";
interface RouteRule {
  auth: Auth;
  module: string | null;
  /** Why a platform or public route has no module or no sign-in. */
  why?: string;
}

const ROUTES: Record<string, RouteRule> = {
  "admin/ai-providers": { auth: "operator", module: null, why: "server settings" },
  "admin/feedback": { auth: "operator", module: null, why: "server settings" },
  "admin/keys": { auth: "operator", module: null, why: "server settings" },
  "admin/keys/test": { auth: "operator", module: null, why: "server settings" },
  "admin/parsing-provider": { auth: "operator", module: null, why: "server settings" },
  "admin/users": { auth: "owner", module: null, why: "household members" },
  "bins/home-assistant": { auth: "session", module: "bins" },
  "ai-keys": { auth: "session", module: null, why: "the household's AI keys serve several modules" },

  "assistant/chat": { auth: "session", module: "assistant" },
  "assistant/conversations": { auth: "session", module: "assistant" },
  "assistant/conversations/[id]": { auth: "session", module: "assistant" },
  "assistant/conversations/[id]/read": { auth: "session", module: "assistant" },
  "assistant/home-assistant": { auth: "session", module: "assistant" },
  "assistant/limits": { auth: "session", module: "assistant" },
  "assistant/memories": { auth: "session", module: "assistant" },
  "assistant/memories/[id]": { auth: "session", module: "assistant" },
  "assistant/notify-prefs": { auth: "session", module: "assistant" },
  "assistant/photos": { auth: "session", module: "assistant" },
  "assistant/proposals/[id]": { auth: "session", module: "assistant" },
  "assistant/settings": { auth: "session", module: "assistant" },
  "assistant/status": { auth: "session", module: "assistant" },
  "assistant/telegram": { auth: "session", module: "assistant" },
  "assistant/telegram/webhook": { auth: "signed", module: null, why: "Telegram's secret header; the linked person's household is checked per message" },
  "assistant/usage": { auth: "session", module: "assistant" },

  "auth/bypass": { auth: "public", module: null, why: "test login, 404 in production unless ALLOW_AUTH_BYPASS" },

  "calendar/calendars": { auth: "session", module: "google-calendar" },
  "calendar/connection": { auth: "session", module: "google-calendar" },
  "calendar/dismiss": { auth: "session", module: "google-calendar" },
  "calendar/events": { auth: "session", module: "google-calendar" },
  "calendar/import": { auth: "session", module: "google-calendar" },
  "calendar/share": { auth: "session", module: "google-calendar" },
  "calendar/status": { auth: "session", module: "google-calendar" },
  "calendar/suggestions": { auth: "session", module: "google-calendar" },
  "calendar/unshare": { auth: "session", module: "google-calendar" },

  directions: { auth: "session", module: null, why: "a map lookup that Home Search and the calendar both use" },
  "event-forecast": { auth: "session", module: null, why: "weather lookup only, no household data" },
  "event-travel": { auth: "session", module: null, why: "a travel-time lookup only, no household data" },
  "geocode-backfill": { auth: "session", module: "search" },
  "feedback/crash": { auth: "session", module: null, why: "crash reports from the error screen, for every module" },
  "feedback/crash/upstream": {
    auth: "public",
    module: null,
    why: "self-hosted servers have no account here; hosted only, scrubbed, capped per day",
  },
  geocode: { auth: "session", module: null, why: "address lookup for several modules" },
  mcp: { auth: "pat", module: null, why: "the mcp module is checked inside, per tool and for the whole endpoint" },
  "money/summaries": { auth: "cron", module: null, why: "the daily job checks each household's modules" },
  "nearby-pois": { auth: "session", module: null, why: "a map lookup that Home Search and Home both use" },
  "oauth/authorize": { auth: "session", module: null, why: "MCP sign-in" },
  "oauth/connections": { auth: "session", module: null, why: "MCP sign-in" },
  "oauth/register": { auth: "public", module: null, why: "OAuth client registration, which the spec makes public" },
  "oauth/token": { auth: "public", module: null, why: "the OAuth token exchange checks the code or refresh token itself" },

  "parse-event": { auth: "session", module: "calendar" },
  "parse-bins": { auth: "session", module: "bins" },
  "parse-listing": { auth: "session", module: "search" },
  "parse-receipt": { auth: "session", module: "groceries" },
  "meal-plan/draft": { auth: "session", module: "meals" },
  "parse-recipe": { auth: "session", module: "recipes" },

  pat: { auth: "session", module: null, why: "the person's bot key" },
  "poi-backfill": { auth: "session", module: "search" },
  "public-config": { auth: "public", module: null, why: "what a sign-in screen needs before anyone signs in" },
  "push/device-token": { auth: "session", module: null, why: "notifications for every module" },
  "push/subscribe": { auth: "session", module: null, why: "notifications for every module" },
  "server-update": { auth: "session", module: null, why: "server upgrades, told only to the people who run the server" },
  "server-update/install": { auth: "session", module: null, why: "server upgrades, started only by the people who run the server" },
  "setup/first-user": { auth: "public", module: null, why: "the first account on a new server, closed once any account exists" },
  "setup/status": { auth: "public", module: null, why: "only says whether any account exists" },

  "shopper/deals": { auth: "session", module: "shopper" },
  "shopper/lookup": { auth: "session", module: "shopper" },
  "shopper/offers": { auth: "session", module: "shopper" },
  "shopper/refresh": { auth: "cron", module: null, why: "the price job checks each household's modules" },
  "shopper/scout": { auth: "session", module: "shopper" },
  "shopper/scout/[id]": { auth: "session", module: "shopper" },
  "shopper/scout/[id]/messages": { auth: "session", module: "shopper" },
  "shopper/scout/picks/[id]": { auth: "session", module: "shopper" },
  "shopper/sources": { auth: "session", module: "shopper" },

  storage: { auth: "session", module: null, why: "file uploads for Documents, photos and receipts" },

  "bank-import": { auth: "session", module: null, why: "bank statement import is a connector in Settings, not a module" },
  "up-bank": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/digest": { auth: "cron", module: null, why: "the weekly job checks each household" },
  "up-bank/links/[costItemId]": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/links/[costItemId]/merge": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/overview": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/payees": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/spending": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/transactions": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/transactions/[id]": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/shops": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/transactions/[id]/cost": { auth: "session", module: null, why: "Up Bank is a connector in Settings, not a module" },
  "up-bank/webhook/[hookId]": { auth: "signed", module: null, why: "Up's HMAC signature with the connection's secret" },

  weather: { auth: "session", module: null, why: "Home's weather" },
};

// What each guard looks like in a route's source. The area helpers
// (assistantRequest, shopperRequest, upRequest) read the session first.
const AUTH_PATTERNS: Record<Exclude<Auth, "public">, RegExp> = {
  session: /\b(getSessionUser|assistantRequest|shopperRequest|upRequest)\(|\.auth\.getUser\(/,
  operator: /\brequireServerOperator\(/,
  owner: /\brequireOwner\(/,
  pat: /\bresolvePatUser\(/,
  cron: /process\.env\.CRON_SECRET/,
  signed: /\b(sameSecret|upSignatureValid)\(/,
};

// Helpers that gate one module for every route that calls them.
const MODULE_HELPERS: Record<string, RegExp> = {
  assistant: /\bassistantRequest\(/,
  shopper: /\bshopperRequest\(/,
};

const API_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const found = new Map(
  routeFiles(API_DIR).map((file) => [relative(API_DIR, file).split(sep).slice(0, -1).join("/"), readFileSync(file, "utf8")])
);

function gatesModule(src: string, module: string): boolean {
  if (MODULE_HELPERS[module]?.test(src)) return true;
  return [...src.matchAll(/requireModules\(([^)]*)\)/g)].some((m) => m[1].includes(`"${module}"`) || m[1].includes(`'${module}'`));
}

describe("API route guards", () => {
  it("lists every route, and no route that is gone", () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it("names real modules, and says why a route has no module or no sign-in", () => {
    const ids = new Set(MODULES.map((m) => m.id));
    for (const [route, rule] of Object.entries(ROUTES)) {
      if (rule.module) expect(ids.has(rule.module as never), `${route}: unknown module ${rule.module}`).toBe(true);
      if (!rule.module || rule.auth === "public") expect(rule.why, `${route} needs a why`).toBeTruthy();
    }
  });

  it.each(Object.entries(ROUTES).filter(([, r]) => r.auth !== "public"))("%s runs its guard", (route, rule) => {
    const src = found.get(route) ?? "";
    expect(AUTH_PATTERNS[rule.auth as Exclude<Auth, "public">].test(src)).toBe(true);
  });

  it.each(Object.entries(ROUTES).filter(([, r]) => r.module))("%s answers 404 when its module is off", (route, rule) => {
    expect(gatesModule(found.get(route) ?? "", rule.module!)).toBe(true);
  });

  it("each module gate is real: the check fails without it", () => {
    const src = found.get("parse-receipt") ?? "";
    expect(gatesModule(src, "groceries")).toBe(true);
    expect(gatesModule(src.replace(/requireModules\([^)]*\)/g, ""), "groceries")).toBe(false);
    expect(gatesModule(src, "recipes")).toBe(false);
  });
});
