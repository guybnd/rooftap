import { describe, expect, it } from "vitest";
import { resolveLegalLinks } from "./legal-links";

describe("resolveLegalLinks", () => {
  it("resolves relative paths against the server", () => {
    expect(resolveLegalLinks({ termsUrl: "/terms", privacyUrl: "/privacy" }, "https://home.example.com")).toEqual({
      termsUrl: "https://home.example.com/terms",
      privacyUrl: "https://home.example.com/privacy",
    });
  });

  it("keeps absolute links", () => {
    expect(resolveLegalLinks({ termsUrl: "https://a.example.com/t", privacyUrl: "https://a.example.com/p" }, "https://home.example.com")).toEqual({
      termsUrl: "https://a.example.com/t",
      privacyUrl: "https://a.example.com/p",
    });
  });

  it("returns null when a link is missing or not http(s)", () => {
    expect(resolveLegalLinks(null, "https://home.example.com")).toBeNull();
    expect(resolveLegalLinks(undefined, "https://home.example.com")).toBeNull();
    expect(resolveLegalLinks({ termsUrl: "/terms" }, "https://home.example.com")).toBeNull();
    expect(resolveLegalLinks({ termsUrl: "javascript:alert(1)", privacyUrl: "/privacy" }, "https://home.example.com")).toBeNull();
  });
});
