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

function admin(allowed: boolean, group: Record<string, unknown> = { region: "AU", home_lat: null, home_lng: null }) {
  const rpc = vi.fn(async () => ({ data: allowed, error: null }));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: group }) }) }) }));
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
    expect((await webTools(admin(true), "g")).tools).toEqual([]);
    keys.set("SERPAPI_API_KEY", "k");
    keys.set("ASSISTANT_WEB", "off");
    expect((await webTools(admin(true), "g")).tools).toEqual([]);
  });

  it("offers search and page reading as lookups", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const { tools } = await webTools(admin(true), "g");
    expect(tools.map((t) => [t.name, t.gate, t.lookup])).toEqual([
      ["web_search", "run", true],
      ["read_page", "run", true],
    ]);
  });

  it("stops searching once the day's allowance is used", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const [search] = (await webTools(admin(false), "g")).tools;
    const out = await search.run({ query: "airmesh thong price" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("today's 10 web searches");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("searches Google Shopping in the household's region", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shopping_results: [{ title: "A", source: "S", price: "$5" }] })));
    const [search] = (await webTools(admin(true), "g")).tools;
    const out = JSON.parse((await search.run({ query: "airmesh", kind: "shopping" })).content[0].text);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("engine")).toBe("google_shopping");
    expect(url.searchParams.get("gl")).toBe("au");
    expect(out.shopping).toEqual([{ title: "A", store: "S", url: null, price: "$5" }]);
    fetchSpy.mockRestore();
  });

  it("searches places around the device first, then the home", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ local_results: [{ title: "Dogs R Us", address: "1 Lygon St", rating: 4.6 }] })));
    const home = admin(true, { region: "AU", home_lat: -37.81361, home_lng: 144.96305 });

    const device = await webTools(home, "g", { here: { lat: -37.768, lng: 144.962 } });
    expect(device.where).toBe("device");
    const out = JSON.parse((await device.tools[0].run({ query: "hot dogs", kind: "places" })).content[0].text);
    let url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("engine")).toBe("google_maps");
    expect(url.searchParams.get("ll")).toBe("@-37.768,144.962,15z");
    expect(out.places[0]).toMatchObject({ name: "Dogs R Us", address: "1 Lygon St", rating: 4.6 });

    const fromHome = await webTools(home, "g");
    expect(fromHome.where).toBe("home");
    await fromHome.tools[0].run({ query: "hot dogs", kind: "places" });
    url = new URL(String(fetchSpy.mock.calls[1][0]));
    expect(url.searchParams.get("ll")).toBe("@-37.81,144.96,15z");

    await fromHome.tools[0].run({ query: "hot dogs", kind: "places", near: "Fitzroy VIC" });
    url = new URL(String(fetchSpy.mock.calls[2][0]));
    expect(url.searchParams.get("q")).toBe("hot dogs near Fitzroy VIC");
    expect(url.searchParams.get("ll")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("asks for a suburb when nothing gives a location", async () => {
    keys.set("SERPAPI_API_KEY", "k");
    const { tools, where } = await webTools(admin(true), "g");
    expect(where).toBeNull();
    const out = await tools[0].run({ query: "hot dogs", kind: "places" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("suburb");
  });

  it("prefers Serper, posts the search and counts its cost", async () => {
    keys.set("SERPAPI_API_KEY", "old");
    keys.set("SERPER_API_KEY", "new");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ organic: [{ title: "T", link: "https://x.example/", snippet: "s" }], answerBox: { answer: "42" } })));
    const web = await webTools(admin(true), "g");
    const out = JSON.parse((await web.tools[0].run({ query: "meaning of life" })).content[0].text);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://google.serper.dev/search");
    expect((init as RequestInit).headers).toMatchObject({ "X-API-KEY": "new" });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ q: "meaning of life", gl: "au" });
    expect(out).toMatchObject({ answer: "42", results: [{ title: "T", url: "https://x.example/", snippet: "s" }] });
    expect(web.spentMicros()).toBe(1000);

    await webTools(admin(true, { region: "AU", home_lat: -37.81, home_lng: 144.96 }), "g").then((w) => w.tools[0].run({ query: "hot dogs", kind: "places" }));
    const [mapsUrl, mapsInit] = fetchSpy.mock.calls[1];
    expect(String(mapsUrl)).toBe("https://google.serper.dev/maps");
    expect(JSON.parse(String((mapsInit as RequestInit).body))).toMatchObject({ q: "hot dogs", ll: "@-37.81,144.96,15z" });
    fetchSpy.mockRestore();
  });

  it("skips the daily count when uncapped", async () => {
    keys.set("SERPER_API_KEY", "k");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const a = admin(false);
    const [search] = (await webTools(a, "g", { capped: false })).tools;
    expect((await search.run({ query: "x" })).isError).toBeFalsy();
    expect((a as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
