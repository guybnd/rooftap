import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host === "evil.example" ? "10.0.0.1" : "93.184.216.34", family: 4 }]),
}));
const keys = new Map<string, string>();
vi.mock("@/lib/admin-config", () => ({ resolveServerKey: vi.fn(async (k: string) => keys.get(k)) }));

import { fetchPage, webTools } from "./web-tools";

function page(status: number, body = "", headers: Record<string, string> = {}) {
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers: { "content-type": "text/html", ...headers } });
}

function admin(allowed: boolean) {
  const rpc = vi.fn(async () => ({ data: allowed, error: null }));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { region: "AU" } }) }) }) }));
  return { rpc, from } as never;
}

beforeEach(() => keys.clear());

describe("fetchPage", () => {
  it("follows a redirect to a public page", async () => {
    const f = vi.fn().mockResolvedValueOnce(page(302, "", { location: "/b" })).mockResolvedValueOnce(page(200, "<p>hi</p>"));
    const out = await fetchPage("https://example.com/a", f as never);
    expect(out).toEqual({ url: "https://example.com/b", html: "<p>hi</p>" });
  });

  it("refuses a redirect to a host that resolves to a private address", async () => {
    const f = vi.fn().mockResolvedValueOnce(page(302, "", { location: "https://evil.example/" }));
    expect(await fetchPage("https://example.com/a", f as never)).toEqual({ error: "That link can't be opened." });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses files that aren't pages", async () => {
    const f = vi.fn().mockResolvedValueOnce(page(200, "x", { "content-type": "application/pdf" }));
    expect(await fetchPage("https://example.com/a.pdf", f as never)).toEqual({ error: "That link isn't a web page." });
  });
});

describe("webTools", () => {
  it("offers nothing without a SerpApi key, or when switched off", async () => {
    expect(await webTools(admin(true), "g")).toEqual([]);
    keys.set("SERPAPI_API_KEY", "k");
    keys.set("ASSISTANT_WEB", "off");
    expect(await webTools(admin(true), "g")).toEqual([]);
  });

  it("offers search and page reading as lookups", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const tools = await webTools(admin(true), "g");
    expect(tools.map((t) => [t.name, t.gate, t.lookup])).toEqual([
      ["web_search", "run", true],
      ["read_page", "run", true],
    ]);
  });

  it("stops searching once the day's allowance is used", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const [search] = await webTools(admin(false), "g");
    const out = await search.run({ query: "airmesh thong price" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("today's 25 web searches");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("searches Google Shopping in the household's region", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shopping_results: [{ title: "A", source: "S", price: "$5" }] })));
    const [search] = await webTools(admin(true), "g");
    const out = JSON.parse((await search.run({ query: "airmesh", kind: "shopping" })).content[0].text);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("engine")).toBe("google_shopping");
    expect(url.searchParams.get("gl")).toBe("au");
    expect(out.shopping).toEqual([{ title: "A", store: "S", url: null, price: "$5" }]);
    fetchSpy.mockRestore();
  });
});
