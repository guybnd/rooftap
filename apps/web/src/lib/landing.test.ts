import { describe, expect, it } from "vitest";
import { isLandingPageEnabled } from "./landing";

describe("isLandingPageEnabled", () => {
  it("is on for Vercel deployments and off for self-hosted ones by default", () => {
    expect(isLandingPageEnabled({ VERCEL: "1" })).toBe(true);
    expect(isLandingPageEnabled({})).toBe(false);
  });

  it("follows HOMEUP_LANDING_PAGE when it is set", () => {
    expect(isLandingPageEnabled({ HOMEUP_LANDING_PAGE: "1" })).toBe(true);
    expect(isLandingPageEnabled({ HOMEUP_LANDING_PAGE: "true" })).toBe(true);
    expect(isLandingPageEnabled({ HOMEUP_LANDING_PAGE: "0", VERCEL: "1" })).toBe(false);
    expect(isLandingPageEnabled({ HOMEUP_LANDING_PAGE: "false", VERCEL: "1" })).toBe(false);
  });
});
