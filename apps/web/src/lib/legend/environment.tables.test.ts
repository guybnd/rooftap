// The web's IndexedDB persist plugin opens one database with a fixed list of
// object stores (INDEXEDDB_TABLES in environment.ts). A synced store whose
// storageName is missing from that list throws "One of the specified object
// stores was not found" on every page and never reports loaded, so a screen
// that waits for it shows "Loading…" forever. Shopper and cook sessions
// shipped like that (found Oct 28). This fails the gate when a store in core
// persists to a table the web never declared.
// The list comes from STORE_MODULES, so this now checks that every store's
// table is a synced table in some module's manifest.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INDEXEDDB_BASE, INDEXEDDB_TABLES, INDEXEDDB_VERSION } from "./environment";

const root = path.join(__dirname, "../../../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function storageNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const dir of ["packages/core/src", "apps/web/src"]) {
    for (const file of walk(path.join(root, dir))) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/storageName:\s*['"]([a-z0-9_]+)['"]/g)) {
        names.set(m[1], path.relative(root, file));
      }
    }
  }
  return names;
}

// The object stores at INDEXEDDB_BASE.version. The version counts tables
// added after these, so none of them may leave the list.
const TABLES_AT_BASE = [
  "grocery_items",
  "household_tasks",
  "cost_items",
  "setup_items",
  "checklists",
  "checklist_task_items",
  "checklist_templates",
  "checklist_template_items",
  "recipes",
  "recipe_ingredients",
  "events",
  "apartments",
  "agents",
  "apartment_agents",
  "apartment_comments",
  "saved_searches",
  "appointments",
  "checklist_items",
  "checklist_responses",
  "documents",
  "loyalty_cards",
  "reward_schemes",
  "reward_partners",
  "reward_perks",
  "occasions",
  "gift_ideas",
  "wishlist_items",
  "bin_streams",
  "bin_changes",
  "bin_plans",
  "care_jobs",
  "meal_plan_entries",
  "recipe_staples",
  "ingredient_aliases",
  "cook_sessions",
  "shopper_wants",
  "shopper_price_snapshots",
  "shopper_searches",
  "shopper_offers",
  "shopper_picks",
];

describe("web IndexedDB tables", () => {
  it("declares a table for every synced store's storageName", () => {
    const names = storageNames();
    expect(names.size).toBeGreaterThan(20);
    const declared = new Set(INDEXEDDB_TABLES);
    const missing = [...names].filter(([name]) => !declared.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing, "give these tables a `sync` list in their module's manifest").toEqual([]);
  });

  it("only ever adds tables, so the version moves with every new one", () => {
    expect(TABLES_AT_BASE).toHaveLength(INDEXEDDB_BASE.tables);
    expect(TABLES_AT_BASE.filter((t) => !INDEXEDDB_TABLES.includes(t))).toEqual([]);
    expect(INDEXEDDB_VERSION).toBe(INDEXEDDB_BASE.version + INDEXEDDB_TABLES.length - INDEXEDDB_BASE.tables);
  });
});
