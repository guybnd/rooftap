import { describe, expect, it } from "vitest";
import {
  ALL_MODULE_IDS,
  MODULES,
  availableModules,
  dependantsOf,
  hiddenWithDisabledModules,
  isSectionEnabled,
  needsModulePicker,
  parseModuleList,
  resolveEnabledModules,
  withModuleChoice,
  type ModuleId,
} from "./modules";
import { getEnabledSections, getModuleIdForPath, sections } from "./sections";

const DEFAULT_ON = MODULES.filter((m) => m.defaultEnabled).map((m) => m.id).sort();

describe("resolveEnabledModules", () => {
  it("uses each module's default when the household has no rows", () => {
    const on = resolveEnabledModules({ available: null, rows: [] });
    expect([...on].sort()).toEqual(DEFAULT_ON);
  });

  it("ships the base set on by default: Tasks, Calendar, Checklists, Documents", () => {
    expect(DEFAULT_ON).toEqual(["calendar", "checklists", "documents", "household"]);
  });

  it("lets a row override the default in either direction", () => {
    const on = resolveEnabledModules({
      available: null,
      rows: [
        { module_id: "groceries", enabled: true },
        { module_id: "calendar", enabled: false },
      ],
    });
    expect(on.has("groceries")).toBe(true);
    expect(on.has("calendar")).toBe(false);
  });

  it("never enables a module the server doesn't offer, even if switched on", () => {
    const on = resolveEnabledModules({
      available: ["household", "calendar"],
      rows: [{ module_id: "groceries", enabled: true }],
    });
    expect([...on].sort()).toEqual(["calendar", "household"]);
  });

  it("ignores rows for unknown module ids", () => {
    const on = resolveEnabledModules({
      available: null,
      rows: [{ module_id: "not-a-module", enabled: true }],
    });
    expect(on.has("not-a-module" as never)).toBe(false);
  });

  it("can switch every module on", () => {
    const on = resolveEnabledModules({
      available: null,
      rows: ALL_MODULE_IDS.map((module_id) => ({ module_id, enabled: true })),
    });
    expect(on.size).toBe(ALL_MODULE_IDS.length);
  });
});

describe("parseModuleList", () => {
  it("treats unset or blank as every module", () => {
    expect(parseModuleList(undefined)).toBeNull();
    expect(parseModuleList(null)).toBeNull();
    expect(parseModuleList("  ")).toBeNull();
  });

  it("trims, dedupes and drops unknown ids", () => {
    expect(parseModuleList(" household, groceries ,typo,household")).toEqual(["household", "groceries"]);
  });

  it("an all-typo list offers nothing rather than everything", () => {
    expect(parseModuleList("nope")).toEqual([]);
  });
});

describe("availableModules", () => {
  it("keeps registry order", () => {
    expect(availableModules(["search", "household"]).map((m) => m.id)).toEqual(["household", "search"]);
    expect(availableModules(null)).toEqual(MODULES);
  });
});

describe("sections and modules", () => {
  it("every module is a real section, apart from the integrations", () => {
    const sectionIds = new Set(sections.map((s) => s.id));
    const integrations = new Set(["google-calendar", "mcp"]);
    for (const id of ALL_MODULE_IDS) expect([id, sectionIds.has(id)]).toEqual([id, !integrations.has(id)]);
  });

  it("keeps Home on even when every module is off", () => {
    expect(isSectionEnabled("home", new Set())).toBe(true);
    expect(isSectionEnabled("profile", new Set())).toBe(true);
    expect(getEnabledSections(new Set()).map((s) => s.id)).toEqual(["home"]);
  });

  it("drops a switched-off module's section", () => {
    const ids = getEnabledSections(new Set(["household", "calendar"])).map((s) => s.id);
    expect(ids).toEqual(["home", "calendar", "household"]);
  });

  it("returns every shipped section when no module set is passed", () => {
    expect(getEnabledSections().length).toBe(sections.filter((s) => s.enabled).length);
  });
});

describe("hiddenWithDisabledModules", () => {
  it("adds every switched-off module to the person's hidden list", () => {
    const enabled = new Set(ALL_MODULE_IDS.filter((id) => id !== "groceries" && id !== "recipes"));
    expect(hiddenWithDisabledModules(["costs"], enabled).sort()).toEqual(["costs", "groceries", "recipes"]);
  });

  it("is the person's list unchanged when every module is on", () => {
    expect(hiddenWithDisabledModules(["costs"], new Set(ALL_MODULE_IDS))).toEqual(["costs"]);
    expect(hiddenWithDisabledModules(null, new Set(ALL_MODULE_IDS))).toEqual([]);
  });
});

describe("modules and routes", () => {
  it("every nav link of a module's section belongs to that module, so the route guard never bounces it", () => {
    for (const section of sections) {
      if (!ALL_MODULE_IDS.includes(section.id as never)) continue;
      for (const href of [section.basePath, ...section.navItems.map((n) => n.href)]) {
        expect([href, getModuleIdForPath(href)]).toEqual([href, section.id]);
      }
    }
  });

  it("platform sections' links map to no module, so they stay reachable with everything off", () => {
    for (const section of sections) {
      if (ALL_MODULE_IDS.includes(section.id as never)) continue;
      for (const href of [section.basePath, ...section.navItems.map((n) => n.href)]) {
        expect([href, getModuleIdForPath(href)]).toEqual([href, null]);
      }
    }
  });

  it("each module, switched off alone, drops only its own section", () => {
    const all = getEnabledSections(new Set(ALL_MODULE_IDS)).map((s) => s.id);
    for (const off of ALL_MODULE_IDS) {
      const ids = getEnabledSections(new Set(ALL_MODULE_IDS.filter((id) => id !== off))).map((s) => s.id);
      expect(ids).toEqual(all.filter((id) => id !== off));
    }
  });

  it("a new household gets Home plus the four base sections", () => {
    const on = resolveEnabledModules({ available: null, rows: [] });
    expect(getEnabledSections(on).map((s) => s.id).sort()).toEqual(
      ["calendar", "checklists", "documents", "home", "household"]
    );
  });
});

describe("dependantsOf", () => {
  it("only Google Calendar hard-requires another module, so only Calendar's switch can lock", () => {
    const all = new Set(ALL_MODULE_IDS);
    for (const id of ALL_MODULE_IDS) {
      expect([id, dependantsOf(id, all).map((m) => m.id)]).toEqual([id, id === "calendar" ? ["google-calendar"] : []]);
    }
    expect(dependantsOf("calendar", new Set(ALL_MODULE_IDS.filter((m) => m !== "google-calendar")))).toEqual([]);
  });

  it("drops Google Calendar when Calendar is off, even with its own switch on", () => {
    const enabled = resolveEnabledModules({
      available: null,
      rows: [
        { module_id: "calendar", enabled: false },
        { module_id: "google-calendar", enabled: true },
      ],
    });
    expect(enabled.has("google-calendar")).toBe(false);
  });

  it("every soft link (enhances) points at a real module", () => {
    for (const m of MODULES) for (const e of m.enhances ?? []) expect(ALL_MODULE_IDS).toContain(e);
  });
});

describe("needsModulePicker", () => {
  const base = { rows: [] as unknown[], isOwner: true, pendingInvitations: 0 };

  it("shows for the owner of a household that has never chosen", () => {
    expect(needsModulePicker(base)).toBe(true);
  });

  it("never shows once the household has any row, from the seed, Settings or the picker", () => {
    expect(needsModulePicker({ ...base, rows: [{ module_id: "mcp", enabled: true }] })).toBe(false);
  });

  it("never shows before the rows load, to a member, or while an invitation waits", () => {
    expect(needsModulePicker({ ...base, rows: null })).toBe(false);
    expect(needsModulePicker({ ...base, isOwner: false })).toBe(false);
    expect(needsModulePicker({ ...base, pendingInvitations: 1 })).toBe(false);
  });
});

describe("withModuleChoice", () => {
  const set = (...ids: ModuleId[]) => new Set<ModuleId>(ids);

  it("ticks and unticks one module, leaving the rest", () => {
    expect([...withModuleChoice(set("household"), "groceries", true)].sort()).toEqual(["groceries", "household"]);
    expect([...withModuleChoice(set("household", "groceries"), "groceries", false)]).toEqual(["household"]);
  });

  it("ticking Google Calendar also ticks Calendar, which it needs", () => {
    expect([...withModuleChoice(set("household"), "google-calendar", true)].sort()).toEqual([
      "calendar",
      "google-calendar",
      "household",
    ]);
  });

  it("unticking Calendar also unticks Google Calendar", () => {
    expect([...withModuleChoice(set("calendar", "google-calendar", "mcp"), "calendar", false)]).toEqual(["mcp"]);
  });

  it("leaves the input set alone", () => {
    const before = set("household");
    withModuleChoice(before, "groceries", true);
    expect([...before]).toEqual(["household"]);
  });

  it("every choice it makes resolves to exactly the ticks", () => {
    let chosen = set();
    for (const id of ALL_MODULE_IDS) {
      for (const on of [true, false, true]) {
        chosen = withModuleChoice(chosen, id, on);
        const rows = ALL_MODULE_IDS.map((m) => ({ module_id: m, enabled: chosen.has(m) }));
        expect([...resolveEnabledModules({ available: null, rows })].sort()).toEqual([...chosen].sort());
      }
    }
  });
});
