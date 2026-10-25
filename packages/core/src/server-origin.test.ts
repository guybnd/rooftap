import { describe, expect, it } from "vitest";
import { isPublicConfig, normalizeServerOrigin, officialServerMove } from "./server-origin";

describe("normalizeServerOrigin", () => {
  it("forces https on a schemeless host", () => {
    expect(normalizeServerOrigin("example.com")).toBe("https://example.com");
  });

  it("preserves an explicit http:// scheme (e.g. LAN self-host)", () => {
    expect(normalizeServerOrigin("http://192.168.1.20:8000")).toBe("http://192.168.1.20:8000");
  });

  it("preserves an explicit https:// scheme", () => {
    expect(normalizeServerOrigin("https://example.com")).toBe("https://example.com");
  });

  it("strips a trailing slash", () => {
    expect(normalizeServerOrigin("https://example.com/")).toBe("https://example.com");
  });

  it("strips any path/query, keeping only scheme+host", () => {
    expect(normalizeServerOrigin("example.com/foo/bar?x=1")).toBe("https://example.com");
  });

  it("keeps a non-default port", () => {
    expect(normalizeServerOrigin("example.com:8000")).toBe("https://example.com:8000");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerOrigin("  example.com  ")).toBe("https://example.com");
  });

  it("empty input throws a user-facing message", () => {
    expect(() => normalizeServerOrigin("")).toThrow("Enter a server address");
    expect(() => normalizeServerOrigin("   ")).toThrow("Enter a server address");
  });

  it("garbage input throws a user-facing message", () => {
    expect(() => normalizeServerOrigin("://not a url")).toThrow(/valid server address/);
  });
});

describe("isPublicConfig", () => {
  it("accepts a well-formed public-config body", () => {
    expect(isPublicConfig({ supabaseUrl: "https://x.example.com", supabaseAnonKey: "anon" })).toBe(true);
  });

  it("rejects a non-Rooftap host's unrelated JSON body", () => {
    expect(isPublicConfig({ hello: "world" })).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(isPublicConfig({ supabaseUrl: "https://x.example.com" })).toBe(false);
    expect(isPublicConfig({ supabaseAnonKey: "anon" })).toBe(false);
  });

  it("rejects empty-string fields", () => {
    expect(isPublicConfig({ supabaseUrl: "", supabaseAnonKey: "" })).toBe(false);
  });

  it("rejects non-object values (e.g. an HTML error page that .json() coerced to null/array)", () => {
    expect(isPublicConfig(null)).toBe(false);
    expect(isPublicConfig(undefined)).toBe(false);
    expect(isPublicConfig("a string")).toBe(false);
    expect(isPublicConfig([])).toBe(false);
  });
});

describe("officialServerMove", () => {
  const known = ["https://homeup.vercel.app"];

  it("moves a phone that picked Official to the new Official address", () => {
    expect(
      officialServerMove({
        storedOrigin: "https://homeup.vercel.app",
        pickedOfficial: true,
        officialUrl: "https://rooftap.example.com/",
        knownOfficialOrigins: known,
      }),
    ).toBe("https://rooftap.example.com");
  });

  it("moves a phone from before the marker when it sits on a known Official address", () => {
    expect(
      officialServerMove({
        storedOrigin: "https://homeup.vercel.app",
        pickedOfficial: false,
        officialUrl: "https://rooftap.example.com",
        knownOfficialOrigins: known,
      }),
    ).toBe("https://rooftap.example.com");
  });

  it("moves back when Official returns to the hosted address", () => {
    expect(
      officialServerMove({
        storedOrigin: "https://rooftap.example.com",
        pickedOfficial: true,
        officialUrl: "https://homeup.vercel.app",
        knownOfficialOrigins: known,
      }),
    ).toBe("https://homeup.vercel.app");
  });

  it("leaves a server the person typed in", () => {
    expect(
      officialServerMove({
        storedOrigin: "https://my-nas.example.com",
        pickedOfficial: false,
        officialUrl: "https://rooftap.example.com",
        knownOfficialOrigins: known,
      }),
    ).toBeNull();
  });

  it("stays when already on Official or when there is no Official", () => {
    const base = { pickedOfficial: true, knownOfficialOrigins: known };
    expect(officialServerMove({ ...base, storedOrigin: "https://homeup.vercel.app", officialUrl: "https://homeup.vercel.app" })).toBeNull();
    expect(officialServerMove({ ...base, storedOrigin: "https://homeup.vercel.app", officialUrl: null })).toBeNull();
  });
});
