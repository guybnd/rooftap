import type { createAdminClient } from "@/lib/supabase/admin";

// The privacy layer for the Assistant's household tools.
//
// Tool handlers run with the admin client, which skips row-level security.
// So every read and write of household data goes through toolData() instead
// of admin.from(): it scopes each query to the caller's household, leaves out
// deleted rows, and applies the table's privacy rule from TOOL_TABLES, the
// same rule the database applies to the person in the app. A handler cannot
// name a table that has no rule (the type is keyof TOOL_TABLES), and
// tool-data.test.ts fails a tool file that calls admin.from() itself.
//
// The household's shared chat (and a shared device) is read by everyone, so
// there a "Just me" row is left out even for its owner, and a row kept from
// anyone is left out for everyone.

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

/** Who may see a table's rows, beyond being in the household. */
export type PrivacyRule =
  /** Every member sees every row. */
  | { kind: "household" }
  /** A row marked private ("Just me") is only for the member in `owner`. */
  | { kind: "private"; owner: "assigned_to" | "created_by" }
  /** A row is hidden from the members in `hidden_from` (a surprise). */
  | { kind: "kept" }
  /** Each row is one member's own, in `owner`. */
  | { kind: "own"; owner: "user_id" };

const HOUSEHOLD = { kind: "household" } as const;
const KEPT = { kind: "kept" } as const;

/**
 * Every table a tool reads or writes, with its privacy rule. `soft: false`
 * marks a table with no `deleted` column. A new table gets its line here,
 * with the rule its RLS policy has.
 */
export const TOOL_TABLES = {
  apartments: { rule: HOUSEHOLD },
  appointments: { rule: HOUSEHOLD },
  bin_changes: { rule: HOUSEHOLD },
  bin_plans: { rule: HOUSEHOLD },
  bin_streams: { rule: HOUSEHOLD },
  care_jobs: { rule: HOUSEHOLD },
  checklist_task_items: { rule: HOUSEHOLD },
  checklist_template_items: { rule: HOUSEHOLD },
  checklist_templates: { rule: HOUSEHOLD },
  checklists: { rule: HOUSEHOLD },
  cook_sessions: { rule: { kind: "own", owner: "user_id" } },
  cost_items: { rule: HOUSEHOLD },
  document_folders: { rule: HOUSEHOLD, soft: false },
  documents: { rule: HOUSEHOLD },
  events: { rule: { kind: "private", owner: "created_by" } },
  gift_ideas: { rule: KEPT },
  grocery_items: { rule: { kind: "private", owner: "assigned_to" } },
  household_tasks: { rule: { kind: "private", owner: "assigned_to" } },
  ingredient_aliases: { rule: HOUSEHOLD },
  loyalty_cards: { rule: { kind: "private", owner: "created_by" } },
  meal_plan_entries: { rule: HOUSEHOLD },
  occasions: { rule: KEPT },
  recipe_ingredients: { rule: HOUSEHOLD },
  recipe_staples: { rule: HOUSEHOLD },
  recipes: { rule: HOUSEHOLD },
  reward_partners: { rule: HOUSEHOLD },
  reward_perks: { rule: HOUSEHOLD },
  reward_schemes: { rule: HOUSEHOLD },
  setup_items: { rule: { kind: "private", owner: "assigned_to" } },
  shopper_searches: { rule: KEPT },
  shopper_wants: { rule: KEPT },
  wishlist_items: { rule: HOUSEHOLD },
  // new-module:tool-table (scripts/new-module.mjs adds above this line)
} satisfies Record<string, { rule: PrivacyRule; soft?: false }>;

export type ToolTable = keyof typeof TOOL_TABLES;

/** The person a tool answers, in their household. */
export interface Viewer {
  userId: string;
  groupId: string;
  /** The household's shared chat or a shared device: everyone reads the answer. */
  shared: boolean;
}

function ruleOf(table: ToolTable): PrivacyRule {
  return TOOL_TABLES[table].rule;
}

function isSoft(table: ToolTable): boolean {
  return !("soft" in TOOL_TABLES[table]);
}

/** Whether this person may see (and so change) a row of the table. */
export function canSee(table: ToolTable, item: object, viewer: Viewer): boolean {
  const row = item as Row;
  const rule = ruleOf(table);
  switch (rule.kind) {
    case "household":
      return true;
    case "private":
      if (!row.private) return true;
      return !viewer.shared && row[rule.owner] === viewer.userId;
    case "kept": {
      const kept = (row.hidden_from as string[] | null | undefined) ?? [];
      return viewer.shared ? kept.length === 0 : !kept.includes(viewer.userId);
    }
    case "own":
      return row[rule.owner] === viewer.userId;
  }
}

/** The columns a rule needs, added to a narrow select so the check can run. */
function ruleColumns(table: ToolTable): string[] {
  const rule = ruleOf(table);
  if (rule.kind === "private") return ["private", rule.owner];
  if (rule.kind === "kept") return ["hidden_from"];
  if (rule.kind === "own") return [rule.owner];
  return [];
}

// The query builder's own types depend on the table name, which is a union
// here, so the layer talks to it through this small shape instead.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Query = any;
/* eslint-enable @typescript-eslint/no-explicit-any */
type Result = { data: unknown; error: { message: string } | null };

/** Adds the rule to a write as filters, so a write can't reach a row the person can't see. */
function guardWrite(q: Query, table: ToolTable, viewer: Viewer): Query {
  const rule = ruleOf(table);
  if (rule.kind === "private") {
    return viewer.shared ? q.eq("private", false) : q.or(`private.eq.false,${rule.owner}.eq.${viewer.userId}`);
  }
  if (rule.kind === "kept") {
    return viewer.shared ? q.eq("hidden_from", "{}") : q.not("hidden_from", "cs", `{${viewer.userId}}`);
  }
  if (rule.kind === "own") return q.eq(rule.owner, viewer.userId);
  return q;
}

function check(res: Result): void {
  if (res.error) throw new Error(res.error.message);
}

export type ToolData = ReturnType<typeof toolData>;

/** Household data as this person may see it. Every method throws on a database error. */
export function toolData(admin: Admin, viewer: Viewer) {
  const from = (table: string): Query => (admin as Query).from(table);

  async function rows<T>(table: ToolTable, where?: (q: Query) => Query, columns = "*"): Promise<T[]> {
    const select = columns === "*" ? "*" : [...new Set([...columns.split(",").map((c) => c.trim()), ...ruleColumns(table)])].join(", ");
    let q = from(table).select(select).eq("group_id", viewer.groupId);
    if (isSoft(table)) q = q.eq("deleted", false);
    if (where) q = where(q);
    const res = (await q) as Result;
    check(res);
    return ((res.data ?? []) as Row[]).filter((r) => canSee(table, r, viewer)) as T[];
  }

  return {
    viewer,

    /**
     * The household's live rows of a table this person may see. `where`
     * narrows the query with more filters (eq, in, gte, order, limit...).
     */
    rows,

    /** One row by id, or null when it is missing, deleted or not for this person. */
    async row<T>(table: ToolTable, id: string): Promise<T | null> {
      return (await rows<T>(table, (q) => q.eq("id", id)))[0] ?? null;
    },

    /** Adds rows to the household (group_id is always this household). */
    async insert(table: ToolTable, row: object | object[]): Promise<void> {
      const list = (Array.isArray(row) ? row : [row]).map((r) => ({ ...r, group_id: viewer.groupId }));
      if (list.length === 0) return;
      check((await from(table).insert(Array.isArray(row) ? list : list[0])) as Result);
    },

    /** Changes rows by id. Rows of another household, or not for this person, are left alone. */
    async update(table: ToolTable, ids: string | readonly string[], patch: object): Promise<void> {
      const list = typeof ids === "string" ? [ids] : [...ids];
      if (list.length === 0) return;
      const q = from(table).update(patch).eq("group_id", viewer.groupId).in("id", list);
      check((await guardWrite(q, table, viewer)) as Result);
    },

    /** Soft-deletes rows by id, under the same rule as update. */
    async remove(table: ToolTable, ids: string | readonly string[]): Promise<void> {
      const list = typeof ids === "string" ? [ids] : [...ids];
      if (list.length === 0) return;
      const q = from(table).update({ deleted: true }).eq("group_id", viewer.groupId).in("id", list);
      check((await guardWrite(q, table, viewer)) as Result);
    },

    /** The household's own row (name, region, currency...). */
    async group<T = Row>(columns = "*"): Promise<T | null> {
      const res = (await from("groups").select(columns).eq("id", viewer.groupId).maybeSingle()) as Result;
      check(res);
      return (res.data as T | null) ?? null;
    },

    /** The household's members' user ids. */
    async memberIds(): Promise<string[]> {
      const res = (await from("group_members").select("user_id").eq("group_id", viewer.groupId)) as Result;
      check(res);
      return ((res.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
    },
  };
}
