import { describe, expect, it } from "vitest";
import { assertPublicUrl, eventPageText, extractJsonLdEvents, isPrivateAddress } from "./event-page";

const PAGE = `<html><head><title>Night Market &amp; Music | Tix</title>
<meta property="og:description" content="Wednesdays at QVM">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Tix"},{"@type":"MusicEvent","name":"Night Market","startDate":"2026-11-04T17:00:00+11:00","location":{"@type":"Place","name":"Queen Victoria Market"}}]}</script>
<script type="application/ld+json">{ broken</script>
<script>window.tracking = true;</script><style>.x{}</style>
</head><body><nav>Home Shows</nav><h1>Night Market</h1><p>Doors 5pm</p><footer>© Tix</footer></body></html>`;

describe("extractJsonLdEvents", () => {
  it("finds Event types inside @graph and skips broken blocks", () => {
    const events = extractJsonLdEvents(PAGE) as { name: string }[];
    expect(events.map((e) => e.name)).toEqual(["Night Market"]);
  });
});

describe("eventPageText", () => {
  it("leads with structured data, then tags, then visible text", () => {
    const text = eventPageText(PAGE);
    expect(text.indexOf("Structured event data")).toBe(0);
    expect(text).toContain("Page title: Night Market & Music | Tix");
    expect(text).toContain("og:description: Wednesdays at QVM");
    expect(text).toContain("Night Market Doors 5pm");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("Home Shows");
  });
});

describe("isPrivateAddress", () => {
  it("flags private and loopback ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["1.1.1.1", "142.250.70.78", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("refuses non-web schemes and private literal hosts", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://127.0.0.1:3000/admin")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertPublicUrl("not a link")).rejects.toThrow();
  });
});
