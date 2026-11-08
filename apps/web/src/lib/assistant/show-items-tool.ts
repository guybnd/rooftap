import {
  SHOWABLE_MODULES,
  SHOW_ITEMS_TOOL,
  SUGGESTABLE_MODULES,
  SUGGEST_ITEMS_MAX,
  SUGGEST_ITEMS_TOOL,
  getModule,
  type AssistantScope,
  type AssistantShown,
  type AssistantSuggestion,
  type ModuleId,
} from "@homeup/core";
import type { AssistantTool } from "./tools";

// show_items: the reply shows household items as their live rows (core
// assistant-view shownGroups), so a list answer is rows the person can tick
// and edit, not a wall of text. The tool only records the ids; each app reads
// the rows from its own synced stores, so nobody sees an item their own view
// does not hold. Offered in the app only (Telegram has no rows).

/** At most this many groups a reply, and ids a group. */
export const SHOW_ITEMS_MAX_GROUPS = 8;
export const SHOW_ITEMS_MAX_IDS = 40;

export function showItemsTool(collect: AssistantShown[], enabled: ReadonlySet<string>): AssistantTool {
  const modules = SHOWABLE_MODULES.filter((m) => enabled.has(m));
  return {
    name: SHOW_ITEMS_TOOL,
    description:
      "Show household items under your reply as their real rows, which the person can tick, open and edit. " +
      "Use it whenever your answer lists items the household has, instead of writing them out. One call per group, " +
      "with a short title (an aisle, 'On the list', 'Running low') and the ids from your lookups. " +
      `Modules: ${modules.map((m) => `${m} (${getModule(m as ModuleId)?.label ?? m})`).join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 60, description: "The group's heading, a few words." },
        module: { type: "string", enum: modules, description: "Which module the items belong to." },
        ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: SHOW_ITEMS_MAX_IDS, description: "The items' ids, in the order to show them." },
      },
      required: ["title", "module", "ids"],
    },
    module: "assistant",
    gate: "run",
    lookup: true,
    run: async (args) => {
      const picked = typeof args.module === "string" ? args.module : "";
      const ids = Array.isArray(args.ids) ? [...new Set(args.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64))] : [];
      const title = typeof args.title === "string" ? args.title.trim().slice(0, 60) : "";
      const error = (message: string) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true });
      if (!modules.includes(picked as ModuleId)) return error(`Pick one of: ${modules.join(", ")}`);
      if (!ids.length) return error("Give the ids of the items to show");
      if (collect.length >= SHOW_ITEMS_MAX_GROUPS) return error(`At most ${SHOW_ITEMS_MAX_GROUPS} groups a reply`);
      collect.push({ title, module: picked as AssistantScope, ids: ids.slice(0, SHOW_ITEMS_MAX_IDS) });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, shown: Math.min(ids.length, SHOW_ITEMS_MAX_IDS), note: "These rows show under your reply. Do not list them again in words." }) }],
      };
    },
  };
}

/**
 * suggest_items: things that are not there yet (an ingredient a dinner
 * needs, a staple worth buying), offered under the reply as rows the person
 * adds with one tap or swipes away. Nothing changes until they do, so the
 * model can offer freely. It shares show_items' group cap.
 */
export function suggestItemsTool(collect: AssistantShown[], enabled: ReadonlySet<string>): AssistantTool | null {
  const modules = SUGGESTABLE_MODULES.filter((m) => enabled.has(m));
  if (!modules.length) return null;
  return {
    name: SUGGEST_ITEMS_TOOL,
    description:
      "Offer things that are not in the household's lists yet as rows under your reply, which the person adds with one tap " +
      "or swipes away. Use it for ideas and gaps (what a dinner still needs, what is worth buying) instead of adding them yourself " +
      "when the person did not ask for the change, and instead of listing them in words. One call per group, with a short title. " +
      `Modules: ${modules.map((m) => `${m} (${getModule(m as ModuleId)?.label ?? m})`).join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 60, description: "The group's heading, a few words, e.g. 'For Tuesday's curry'." },
        module: { type: "string", enum: modules, description: "Which module they would go in." },
        items: {
          type: "array",
          minItems: 1,
          maxItems: SUGGEST_ITEMS_MAX,
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 80, description: "What to add, as it would be named on the list." },
              note: { type: "string", maxLength: 80, description: "Why, in a few words." },
              quantity: { type: "number", minimum: 0 },
              unit: { type: "string", maxLength: 16 },
            },
            required: ["name"],
          },
        },
      },
      required: ["title", "module", "items"],
    },
    module: "assistant",
    gate: "run",
    lookup: true,
    run: async (args) => {
      const picked = typeof args.module === "string" ? args.module : "";
      const title = typeof args.title === "string" ? args.title.trim().slice(0, 60) : "";
      const error = (message: string) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true });
      if (!modules.includes(picked as ModuleId)) return error(`Pick one of: ${modules.join(", ")}`);
      const raw = Array.isArray(args.items) ? args.items : [];
      const items: AssistantSuggestion[] = [];
      for (const it of raw) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
        if (!name || items.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
        items.push({
          name,
          ...(typeof o.note === "string" && o.note.trim() ? { note: o.note.trim().slice(0, 80) } : {}),
          ...(typeof o.quantity === "number" && Number.isFinite(o.quantity) && o.quantity > 0 ? { quantity: o.quantity } : {}),
          ...(typeof o.unit === "string" && o.unit.trim() ? { unit: o.unit.trim().slice(0, 16) } : {}),
        });
      }
      if (!items.length) return error("Give at least one item with a name");
      if (collect.length >= SHOW_ITEMS_MAX_GROUPS) return error(`At most ${SHOW_ITEMS_MAX_GROUPS} groups a reply`);
      collect.push({ title, module: picked as AssistantScope, ids: [], suggest: items.slice(0, SUGGEST_ITEMS_MAX) });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, offered: Math.min(items.length, SUGGEST_ITEMS_MAX), note: "These show as rows to add under your reply. Do not list them again in words, and do not add them yourself." }) }],
      };
    },
  };
}
