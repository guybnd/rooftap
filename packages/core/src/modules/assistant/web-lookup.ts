// The Assistant's own web lookups: a search (Google through SerpApi) and
// reading one page from the results. The server runs both, so they work the
// same with every AI provider. Searches cost the server money, so each
// household gets a daily allowance; pages are free to read but capped too.
// Pure helpers live here; the tools are in apps/web/src/lib/assistant/web-tools.ts.

export const WEB_SEARCH_TOOL = 'web_search';
export const READ_PAGE_TOOL = 'read_page';

/** Searches per household per day (UTC). */
export const WEB_SEARCHES_PER_DAY = 25;
/** Pages read per household per day (UTC). */
export const WEB_PAGES_PER_DAY = 60;
/** Characters of page text handed to the model. */
export const PAGE_TEXT_MAX = 8000;

export type WebLookupKind = 'search' | 'page';

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

/** The parts of a SerpApi Google (or Google Shopping) answer the model needs. */
export function serpSearchAnswer(body: unknown, max = 8): WebSearchAnswer {
  const b = (body ?? {}) as Record<string, unknown>;
  const box = (b.answer_box ?? {}) as Record<string, unknown>;
  const graph = (b.knowledge_graph ?? {}) as Record<string, unknown>;
  const answer = str(box.answer) ?? str(box.snippet) ?? str(graph.description);
  const results: WebResult[] = [];
  for (const r of Array.isArray(b.organic_results) ? b.organic_results : []) {
    const o = r as Record<string, unknown>;
    const title = str(o.title);
    const url = str(o.link);
    if (title && url) results.push({ title, url, snippet: str(o.snippet) });
    if (results.length >= max) break;
  }
  const shopping: WebShoppingResult[] = [];
  for (const r of Array.isArray(b.shopping_results) ? b.shopping_results : []) {
    const o = r as Record<string, unknown>;
    const title = str(o.title);
    const store = str(o.source);
    const price = str(o.price) ?? (typeof o.extracted_price === 'number' ? String(o.extracted_price) : null);
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

/** The prompt lines for the web tools, when the server offers them. */
export const WEB_LOOKUP_TEXT =
  '## The web\n' +
  `You can search the web with ${WEB_SEARCH_TOOL} and open a result with ${READ_PAGE_TOOL}. Use them for facts from ` +
  'outside the household, such as a price, opening hours or how to fix something, before offering a Scout search: ' +
  'Scout is for longer research the person asks for. Name the site for each fact or price you give, and say that a ' +
  'price came from a web search, not from a store Shopper watches. Never put member names, addresses, amounts or ' +
  'anything private from the household in a search. The household has a daily allowance of searches; when it runs ' +
  'out, say so and offer Scout instead.';
