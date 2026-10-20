import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getModuleIdForPath } from "@homeup/core";

// Modules (.docs/modules.md): the sidebar's route guard sends anyone on a
// switched-off module's route to /home, using getModuleIdForPath. Every
// top-level route must be classified here, so a new screen can't ship
// without someone deciding which module it belongs to (or that it's
// platform and stays reachable with every module off).
const EXPECTED: Record<string, string | null> = {
  // Modules
  tasks: "household",
  calendar: "calendar",
  checklists: "checklists",
  documents: "documents",
  groceries: "groceries",
  recipes: "recipes",
  costs: "costs",
  setup: "setup",
  homesearch: "search",
  apartment: "search",
  map: "search",
  appointments: "search",
  checklist: "search",
  // Platform
  home: null,
  settings: null,
  admin: null,
  "share-target": null,
  "~offline": null,
  // the public landing page (middleware rewrites signed-out `/` here)
  landing: null,
  // the privacy page the landing page links to
  privacy: null,
  // (auth) group
  login: null,
  logout: null,
  welcome: null,
  callback: null,
  "calendar-callback": null,
};

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

function topLevelRoutes(dir: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "api" || entry.name.startsWith("_")) continue;
    // Route groups like (auth) don't add a path segment.
    if (entry.name.startsWith("(")) routes.push(...topLevelRoutes(join(dir, entry.name)));
    else routes.push(entry.name);
  }
  return routes;
}

describe("module ownership of web routes", () => {
  const routes = topLevelRoutes(APP_DIR);

  it("classifies every top-level route", () => {
    const unclassified = routes.filter((r) => !(r in EXPECTED));
    expect(unclassified, "add these to EXPECTED with their module, or null for platform").toEqual([]);
  });

  it.each(routes.filter((r) => r in EXPECTED))("/%s belongs to the expected module", (route) => {
    expect(getModuleIdForPath(`/${route}`)).toBe(EXPECTED[route]);
    expect(getModuleIdForPath(`/${route}/some-id`)).toBe(EXPECTED[route]);
  });
});
