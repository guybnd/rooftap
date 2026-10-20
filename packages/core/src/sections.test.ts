import { describe, expect, it } from "vitest";
import { assignTabSlot, getModuleIdForPath, getSectionByPath, splitTabBar } from "./sections";

describe("getSectionByPath", () => {
  it("resolves /homesearch to Home Search, not Home (prefix collision)", () => {
    expect(getSectionByPath("/homesearch").id).toBe("search");
  });

  it("resolves /home to Home", () => {
    expect(getSectionByPath("/home").id).toBe("home");
    expect(getSectionByPath("/home/anything").id).toBe("home");
    expect(getSectionByPath("/share-target").id).toBe("home");
    expect(getSectionByPath("/~offline").id).toBe("home");
  });

  it("resolves the bare root to Home", () => {
    expect(getSectionByPath("/").id).toBe("home");
  });

  it("resolves /settings to the Profile section", () => {
    expect(getSectionByPath("/settings").id).toBe("profile");
  });

  it("resolves /checklist (singular, apartment scoring) to Home Search default", () => {
    expect(getSectionByPath("/checklist").id).toBe("search");
  });

  it("resolves /checklists to the Checklists section", () => {
    expect(getSectionByPath("/checklists").id).toBe("checklists");
    expect(getSectionByPath("/checklists/templates").id).toBe("checklists");
  });

  it("resolves other section base paths without prefix collisions", () => {
    expect(getSectionByPath("/calendar").id).toBe("calendar");
    expect(getSectionByPath("/setup").id).toBe("setup");
    expect(getSectionByPath("/tasks").id).toBe("household");
    expect(getSectionByPath("/costs").id).toBe("costs");
    expect(getSectionByPath("/groceries").id).toBe("groceries");
    expect(getSectionByPath("/recipes").id).toBe("recipes");
    expect(getSectionByPath("/documents").id).toBe("documents");
  });

  it("falls through to Home Search for unrecognized paths", () => {
    expect(getSectionByPath("/unknown-path").id).toBe("search");
  });
});

describe("getModuleIdForPath", () => {
  it("maps every Home Search route to the search module", () => {
    for (const p of ["/homesearch", "/apartment/new", "/apartment/abc", "/map", "/appointments", "/checklist"]) {
      expect(getModuleIdForPath(p)).toBe("search");
    }
  });

  it("maps section routes to their module", () => {
    expect(getModuleIdForPath("/tasks")).toBe("household");
    expect(getModuleIdForPath("/groceries/shelf-life")).toBe("groceries");
    expect(getModuleIdForPath("/checklists/templates")).toBe("checklists");
    expect(getModuleIdForPath("/recipes/123")).toBe("recipes");
  });

  it("leaves platform routes alone (no Home Search fallback)", () => {
    for (const p of ["/", "/home", "/settings", "/settings/groceries", "/share-target", "/admin/backfill-pois", "/login"]) {
      expect(getModuleIdForPath(p)).toBeNull();
    }
  });

  it("does not confuse /home with /homesearch or /checklist with /checklists", () => {
    expect(getModuleIdForPath("/homesearch")).toBe("search");
    expect(getModuleIdForPath("/checklists")).toBe("checklists");
    expect(getModuleIdForPath("/checklist")).toBe("search");
  });
});

describe("splitTabBar", () => {
  it("puts exactly four sections all in the bar", () => {
    expect(splitTabBar([1, 2, 3, 4])).toEqual({ primary: [1, 2, 3, 4], overflow: [] });
  });

  it("puts the first three in the bar and the rest under More", () => {
    expect(splitTabBar([1, 2, 3, 4, 5, 6])).toEqual({ primary: [1, 2, 3], overflow: [4, 5, 6] });
    expect(splitTabBar([1, 2])).toEqual({ primary: [1, 2], overflow: [] });
  });
});

describe("assignTabSlot", () => {
  const order = ["home", "tasks", "groceries", "costs", "recipes"];

  it("swaps the chosen section into the slot", () => {
    expect(assignTabSlot(order, [], "tasks", "recipes")).toEqual({
      order: ["home", "recipes", "groceries", "costs", "tasks"],
      hidden: [],
    });
  });

  it("swaps two sections already in the bar", () => {
    expect(assignTabSlot(order, [], "home", "groceries").order).toEqual([
      "groceries",
      "tasks",
      "home",
      "costs",
      "recipes",
    ]);
  });

  it("shows a hidden choice again", () => {
    expect(assignTabSlot(order, ["recipes", "costs"], "tasks", "recipes").hidden).toEqual(["costs"]);
  });

  it("is a no-op for the section already in the slot or an unknown id", () => {
    const hidden = ["costs"];
    expect(assignTabSlot(order, hidden, "tasks", "tasks")).toEqual({ order, hidden });
    expect(assignTabSlot(order, hidden, "tasks", "nope")).toEqual({ order, hidden });
  });
});
