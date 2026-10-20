// Fetch an event page for /api/parse-event and boil it down to the text the AI
// reads: the page's schema.org Event data (most ticketing sites publish it),
// its title and description tags, then the visible text.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 30_000;

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Refuse anything but a public http(s) host, so a pasted link can't reach the server's own network. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web links can be read.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new Error("That site couldn't be found.");
  if (addresses.some(isPrivateAddress)) throw new Error("That link can't be read.");
  return url;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function hasEventType(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const type = (node as Record<string, unknown>)["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && /Event$/.test(t));
}

/** schema.org Event objects from the page's JSON-LD blocks (inside @graph or arrays too). */
export function extractJsonLdEvents(html: string): unknown[] {
  const events: unknown[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (hasEventType(node)) events.push(node);
    const graph = (node as Record<string, unknown>)["@graph"];
    if (graph) visit(graph);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      // A broken block on someone else's page is not our problem; skip it.
    }
  }
  return events;
}

/** The page reduced to what the AI needs, structured data first. */
export function eventPageText(html: string): string {
  const parts: string[] = [];
  const events = extractJsonLdEvents(html);
  if (events.length) parts.push(`Structured event data:\n${JSON.stringify(events.slice(0, 3)).slice(0, 8_000)}`);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) parts.push(`Page title: ${decodeEntities(title).trim()}`);
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](og:title|og:description|description|og:site_name)["'][^>]*>/gi)) {
    const content = /content=["']([^"']*)["']/i.exec(m[0])?.[1];
    if (content) parts.push(`${m[1]}: ${decodeEntities(content).trim()}`);
  }
  const body = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|footer|svg|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s{2,}/g, " ")
    .trim();
  if (body) parts.push(`Page text:\n${body}`);
  return parts.join("\n\n").slice(0, MAX_TEXT);
}

/** Fetch a public event page as HTML, following at most a few redirects and re-checking each hop. */
export async function fetchEventPage(raw: string): Promise<{ url: string; html: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`The page didn't load (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    return { url: url.toString(), html: new TextDecoder().decode(buf.slice(0, MAX_BYTES)) };
  }
  throw new Error("The link redirected too many times.");
}
