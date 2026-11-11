import { describe, expect, it } from "vitest";
import { serverLegalLinks } from "./legal-links";

describe("serverLegalLinks", () => {
  it("links the hosted pages on Vercel", () => {
    expect(serverLegalLinks({ VERCEL: "1" })).toEqual({ termsUrl: "/terms", privacyUrl: "/privacy" });
  });

  it("shows no line on a self-hosted server by default", () => {
    expect(serverLegalLinks({})).toBeNull();
  });

  it("uses the owner's own pages when both are set", () => {
    expect(serverLegalLinks({ ROOFTAP_TERMS_URL: "https://me.example.com/t", ROOFTAP_PRIVACY_URL: "https://me.example.com/p" })).toEqual({
      termsUrl: "https://me.example.com/t",
      privacyUrl: "https://me.example.com/p",
    });
    expect(serverLegalLinks({ ROOFTAP_TERMS_URL: "https://me.example.com/t" })).toBeNull();
  });

  it("can be turned off", () => {
    expect(serverLegalLinks({ VERCEL: "1", ROOFTAP_LEGAL_LINKS: "0" })).toBeNull();
  });
});
