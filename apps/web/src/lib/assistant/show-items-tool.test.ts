import { describe, expect, it } from "vitest";
import type { AssistantShown } from "@homeup/core";
import { SHOW_ITEMS_MAX_GROUPS, showItemsTool, suggestItemsTool } from "./show-items-tool";

describe("show_items", () => {
  it("records each group for the reply, only for modules that are on", async () => {
    const shown: AssistantShown[] = [];
    const tool = showItemsTool(shown, new Set(["groceries"]));
    const ok = await tool.run({ title: "Dairy", module: "groceries", ids: ["a", "b", "a", 7] });
    expect(ok.isError).toBeFalsy();
    expect(shown).toEqual([{ title: "Dairy", module: "groceries", ids: ["a", "b"] }]);
    const off = await tool.run({ title: "Chores", module: "household", ids: ["t"] });
    expect(off.isError).toBe(true);
    expect(tool.lookup).toBe(true);
  });

  it("caps the groups a reply shows", async () => {
    const shown: AssistantShown[] = [];
    const tool = showItemsTool(shown, new Set(["groceries"]));
    for (let i = 0; i < SHOW_ITEMS_MAX_GROUPS + 2; i++) await tool.run({ title: `G${i}`, module: "groceries", ids: ["a"] });
    expect(shown).toHaveLength(SHOW_ITEMS_MAX_GROUPS);
  });
});

describe("suggest_items", () => {
  it("records named suggestions once each, for modules that take them", async () => {
    const shown: AssistantShown[] = [];
    const tool = suggestItemsTool(shown, new Set(["groceries"]))!;
    const ok = await tool.run({
      title: "For Tuesday",
      module: "groceries",
      items: [{ name: " Coriander ", note: "for the curry" }, { name: "coriander" }, { name: "" }, { name: "Limes", quantity: 2, unit: "count" }],
    });
    expect(ok.isError).toBeFalsy();
    expect(shown).toEqual([
      {
        title: "For Tuesday",
        module: "groceries",
        ids: [],
        suggest: [{ name: "Coriander", note: "for the curry" }, { name: "Limes", quantity: 2, unit: "count" }],
      },
    ]);
    expect((await tool.run({ title: "x", module: "groceries", items: [] })).isError).toBe(true);
  });

  it("is not offered when no module that takes suggestions is on", () => {
    expect(suggestItemsTool([], new Set(["household"]))).toBeNull();
  });
});
