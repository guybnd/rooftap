import { lookup as dnsLookup } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  READ_PAGE_TOOL,
  WEB_PAGES_PER_DAY,
  WEB_SEARCHES_PER_DAY,
  WEB_SEARCH_TOOL,
  isPrivateAddress,
  pageText,
  serpSearchAnswer,
  webPageUrl,
  type WebLookupKind,
} from "@homeup/core";
import { resolveServerKey } from "@/lib/admin-config";
import type { ToolResult } from "@/lib/mcp/household-tools";
import type { AssistantTool } from "./tools";

// The Assistant's own web lookups (core web-lookup.ts): a Google search
// through the server's SerpApi key, and reading one page. Both only look
// things up, so they run without a card. Searches are paid, so each
// household has a daily allowance (assistant_web_lookup_hit); the operator
// takes the tools away with ASSISTANT_WEB=off, and a server without a
// SerpApi key never offers them.

const TIMEOUT_MS = 12_000;
const PAGE_BYTES_MAX = 2_000_000;
const REDIRECTS_MAX = 4;

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(error: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true };
}

/** Counts one lookup; false once the household is past the day's allowance, or when the count can't be kept. */
async function withinAllowance(admin: SupabaseClient, groupId: string, kind: WebLookupKind): Promise<boolean> {
  const { data, error } = await admin.rpc("assistant_web_lookup_hit", {
    p_group_id: groupId,
    p_kind: kind,
    p_limit: kind === "search" ? WEB_SEARCHES_PER_DAY : WEB_PAGES_PER_DAY,
  });
  // Searches cost money, so a count that can't be kept stops them.
  if (error) {
    console.error("[assistant] web allowance check failed", error.message);
    return false;
  }
  return data === true;
}

/** The URL, once its host resolves only to public addresses. */
async function publicUrl(raw: string): Promise<URL | null> {
  const url = webPageUrl(raw);
  if (!url) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = await dnsLookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

/** Opens a page, following redirects by hand so each hop is checked like the first. */
export async function fetchPage(raw: string, fetchImpl: typeof fetch = fetch): Promise<{ url: string; html: string } | { error: string }> {
  let next = raw;
  for (let hop = 0; hop <= REDIRECTS_MAX; hop++) {
    const url = await publicUrl(next);
    if (!url) return { error: "That link can't be opened." };
    let res: Response;
    try {
      res = await fetchImpl(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RooftapAssistant/1.0)", Accept: "text/html,text/plain;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { error: "The page didn't answer." };
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      next = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) return { error: `The page answered ${res.status}.` };
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return { error: "That link isn't a web page." };
    const html = await readCapped(res);
    return { url: url.toString(), html };
  }
  return { error: "The page redirects too many times." };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= PAGE_BYTES_MAX) {
      await reader.cancel();
      break;
    }
  }
  return out;
}

/** The web tools for this turn, or none when the server has no SerpApi key or the operator switched them off. */
export async function webTools(admin: SupabaseClient, groupId: string): Promise<AssistantTool[]> {
  const [key, switch_] = await Promise.all([resolveServerKey("SERPAPI_API_KEY"), resolveServerKey("ASSISTANT_WEB")]);
  if (!key?.trim() || /^(off|false|0|no)$/i.test(switch_?.trim() ?? "")) return [];

  const search: AssistantTool = {
    name: WEB_SEARCH_TOOL,
    description:
      "Search the web (Google) for something outside the household: a price, a product, opening hours, how to do something. " +
      'kind "shopping" searches Google Shopping in the household\'s region and gives stores and prices; "web" (the default) gives pages and snippets. ' +
      "Keep the query short, and never put names, addresses or other private household details in it. Each search counts against a daily allowance.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        kind: { type: "string", enum: ["web", "shopping"] },
      },
      required: ["query"],
    },
    module: "assistant",
    gate: "run",
    lookup: true,
    run: async (args) => {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
      if (!query) return fail("The search is empty.");
      const shopping = args.kind === "shopping";
      const { data: group } = await admin.from("groups").select("region").eq("id", groupId).maybeSingle();
      const region = ((group as { region?: string | null } | null)?.region || "AU").toLowerCase();
      if (!(await withinAllowance(admin, groupId, "search"))) {
        return fail(`The household has used today's ${WEB_SEARCHES_PER_DAY} web searches. Offer a Scout search instead.`);
      }
      const params = new URLSearchParams({
        engine: shopping ? "google_shopping" : "google",
        q: query,
        gl: region,
        hl: "en",
        num: "10",
        api_key: key,
      });
      try {
        const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return fail(`The search didn't work (${res.status}).`);
        return ok({ query, kind: shopping ? "shopping" : "web", region: region.toUpperCase(), ...serpSearchAnswer(await res.json()) });
      } catch {
        return fail("The search didn't answer in time.");
      }
    },
  };

  const read: AssistantTool = {
    name: READ_PAGE_TOOL,
    description:
      "Open a web page, usually a link from web_search, and read its text: to check a price, a detail or a date on the page. " +
      "Long pages are cut short. Count only what the page says; if the text doesn't show it, say so.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "The page's full https link." } },
      required: ["url"],
    },
    module: "assistant",
    gate: "run",
    lookup: true,
    run: async (args) => {
      if (!webPageUrl(args.url)) return fail("That link can't be opened.");
      if (!(await withinAllowance(admin, groupId, "page"))) return fail(`The household has read today's ${WEB_PAGES_PER_DAY} pages.`);
      const page = await fetchPage(String(args.url));
      if ("error" in page) return fail(page.error);
      const { title, text, cut } = pageText(page.html);
      if (!text) return fail("The page has no text to read; it may need a browser to show it.");
      return ok({ url: page.url, title, text, ...(cut ? { note: "The page was cut short." } : {}) });
    },
  };

  return [search, read];
}
