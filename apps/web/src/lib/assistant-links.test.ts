import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEM_LINK_ROUTES, SECTION_LINKS, buildAssistantSystemPrompt, itemLink } from "@homeup/core";

// Links the Assistant gives must open on both platforms.
const root = join(__dirname, "../../../..");
const web = (route: string) => join(root, "apps/web/src/app", route);
const phone = (route: string) => [join(root, "apps/mobile/src/app", route), join(root, "apps/mobile/src/app/(tabs)", route)];

describe("assistant links", () => {
  it("every item route has a detail screen on web and phone", () => {
    for (const prefix of Object.values(ITEM_LINK_ROUTES)) {
      const route = `${prefix}[id]`;
      expect(existsSync(join(web(route), "page.tsx")), `web ${route}`).toBe(true);
      expect(phone(route).some((p) => existsSync(`${p}.tsx`)), `phone ${route}`).toBe(true);
    }
  });

  it("every section link has a screen on web and phone", () => {
    for (const { href } of SECTION_LINKS) {
      expect(existsSync(join(web(href), "page.tsx")), `web ${href}`).toBe(true);
      expect(phone(href).some((p) => existsSync(join(p, "index.tsx")) || existsSync(`${p}.tsx`)), `phone ${href}`).toBe(true);
    }
  });

  it("builds item links and tells the app channel about them only", () => {
    expect(itemLink("recipe", "abc-1")).toBe("/recipes/abc-1");
    const base = { now: "Friday", timeZone: "Australia/Melbourne", person: "Sam", members: ["Sam"], modules: [], memories: [], kind: "chat" as const };
    expect(buildAssistantSystemPrompt({ ...base, channel: "app" })).toContain("## Links");
    expect(buildAssistantSystemPrompt({ ...base, channel: "telegram" })).not.toContain("## Links");
  });
});
