// The Assistant's own web lookups: a search (Google through SerpApi) and
// reading one page from the results. The server runs both, so they work the
// same with every AI provider. Searches cost the server money, so each
// household gets a daily allowance; pages are free to read but capped too.
// Pure helpers live here; the tools are in apps/web/src/lib/assistant/web-tools.ts.

export const WEB_SEARCH_TOOL = 'web_search';
export const READ_PAGE_TOOL = 'read_page';

/** Searches per household per day (UTC) on a hosted server; self-hosted and exempt households have no cap. */
export const WEB_SEARCHES_PER_DAY = 10;
/** Pages read per household per day (UTC), with the same exceptions. */
export const WEB_PAGES_PER_DAY = 60;
/** Characters of page text handed to the model. */
export const PAGE_TEXT_MAX = 8000;

export type WebLookupKind = 'search' | 'page';

/** Where the person is right now, from their device, rounded to about 100 m. Used for one turn and never stored. */
export interface WebHere {
  lat: number;
  lng: number;
}

const NEARBY = /\b(near(by| me| here| us)|close (to )?(me|here|by|us)|around (me|here|us)|closest|nearest|in my area|walking distance)\b/i;

/** The message asks about places near the person, so the app may send where they are. */
export function looksNearby(text: string): boolean {
  return NEARBY.test(text);
}

/** A position the app sent, rounded to three decimals (about 100 m); null for anything else. */
export function cleanHere(value: unknown): WebHere | null {
  const v = value as { lat?: unknown; lng?: unknown } | null;
  if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') return null;
  if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { lat: round(v.lat), lng: round(v.lng) };
}

export interface WebPlace {
  name: string;
  address: string | null;
  type: string | null;
  rating: number | null;
  reviews: number | null;
  price: string | null;
  open: string | null;
  website: string | null;
}

/** The places in a Google Maps answer, from SerpApi (local_results) or Serper (places). */
export function serpPlaces(body: unknown, max = 8): WebPlace[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(b.local_results) ? b.local_results : Array.isArray(b.places) ? b.places : b.place_results ? [b.place_results] : [];
  const places: WebPlace[] = [];
  for (const r of list) {
    const o = r as Record<string, unknown>;
    const name = str(o.title);
    if (!name) continue;
    places.push({
      name,
      address: str(o.address),
      type: str(o.type) ?? str(o.category),
      rating: typeof o.rating === 'number' ? o.rating : null,
      reviews: typeof o.reviews === 'number' ? o.reviews : typeof o.ratingCount === 'number' ? o.ratingCount : null,
      price: str(o.price) ?? str(o.priceLevel),
      open: str(o.open_state) ?? str(o.hours),
      website: str(o.website),
    });
    if (places.length >= max) break;
  }
  return places;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string | null;
}

export interface WebShoppingResult {
  title: string;
  store: string;
  url: string | null;
  price: string;
}

export interface WebSearchAnswer {
  /** Google's own answer box or knowledge panel line, when it has one. */
  answer: string | null;
  results: WebResult[];
  shopping: WebShoppingResult[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The parts of a Google (or Google Shopping) answer the model needs, from SerpApi or Serper. */
export function serpSearchAnswer(body: unknown, max = 8): WebSearchAnswer {
  const b = (body ?? {}) as Record<string, unknown>;
  const box = (b.answer_box ?? b.answerBox ?? {}) as Record<string, unknown>;
  const graph = (b.knowledge_graph ?? b.knowledgeGraph ?? {}) as Record<string, unknown>;
  const organic = b.organic_results ?? b.organic;
  const shop = b.shopping_results ?? b.shopping;
  const answer = str(box.answer) ?? str(box.snippet) ?? str(graph.description);
  const results: WebResult[] = [];
  for (const r of Array.isArray(organic) ? organic : []) {
    const o = r as Record<string, unknown>;
    const title = str(o.title);
    const url = str(o.link);
    if (title && url) results.push({ title, url, snippet: str(o.snippet) });
    if (results.length >= max) break;
  }
  const shopping: WebShoppingResult[] = [];
  for (const r of Array.isArray(shop) ? shop : []) {
    const o = r as Record<string, unknown>;
    const title = str(o.title);
    const store = str(o.source);
    const num = typeof o.extracted_price === 'number' ? o.extracted_price : typeof o.price === 'number' ? o.price : null;
    const price = str(o.price) ?? (num !== null ? String(num) : null);
    if (title && store && price) shopping.push({ title, store, url: str(o.product_link) ?? str(o.link), price });
    if (shopping.length >= max) break;
  }
  return { answer, results, shopping };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text from an HTML page: no scripts, styles or tags, entities decoded, whitespace folded. */
export function pageText(html: string, max = PAGE_TEXT_MAX): { title: string | null; text: string; cut: boolean } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const text = html
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
  const clean = (title ? pageText(title, 200).text : '') || null;
  return { title: clean, text: text.slice(0, max), cut: text.length > max };
}

/** An http(s) link the server may open: no credentials, no odd ports, no bare or local host names. */
export function webPageUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') && !host.includes(':')) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (isPrivateAddress(host.replace(/^\[|\]$/g, ''))) return null;
  url.hash = '';
  return url;
}

/**
 * True for an address a server must never fetch from a model's link: loopback,
 * private, link-local (cloud metadata), carrier NAT, multicast and the like.
 * Host names that aren't IP literals return false; the caller checks what
 * they resolve to.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!address.includes(':')) return false;
  const v6 = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith('ff') ||
    v6.startsWith('::ffff:')
  );
}

/** Where "near me" searches start from this turn. */
export type WebWhere = 'device' | 'home' | null;

/** The prompt lines for the web tools, when the server offers them. */
export function webLookupText(where: WebWhere = null): string {
  const near =
    where === 'device'
      ? 'Their device shared where they are right now, so a places search finds what is near them.'
      : where === 'home'
        ? "A places search starts from the household's home, which is saved in Settings. If they say they are somewhere else, pass that place as `near`."
        : 'Neither their device nor the household shared a location. Before a places search, ask once for their suburb or town, ' +
          'pass it as `near`, and remember it with a remember marker. Never guess a city.';
  return (
    '## The web\n' +
    `You can search the web with ${WEB_SEARCH_TOOL} and open a result with ${READ_PAGE_TOOL}. Use them for facts from ` +
    'outside the household, such as a price, opening hours or how to fix something, before offering a Scout search: ' +
    'Scout is for longer research the person asks for. For somewhere to go (a cafe, a shop, a plumber), search with kind ' +
    `"places". ${near} Name the site for each fact or price you give, and say that a ` +
    'price came from a web search, not from a store Shopper watches. Never put member names, addresses, amounts or ' +
    'anything private from the household in a search. The household has a daily allowance of searches; when it runs ' +
    'out, say so and offer Scout instead.'
  );
}
