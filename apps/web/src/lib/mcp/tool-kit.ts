import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ModuleId } from "@homeup/core";
import { memberNames } from "@/lib/member-names";
import { personTimeZone, todayIn } from "@/lib/meal-plan-server";
import { toolData, type ToolData } from "./tool-data";

// The shared parts of the Assistant's household tools: the tool types, the
// result shapes, a few helpers, and the tool() registrar that answers "no
// household" and turns a thrown error into a tool error. Each file in tools/
// builds one tile's tools with it (scripts/new-module.mjs writes one too).
// Household data is read and written through `db` (tool-data.ts), which
// applies each table's privacy rule; a tool file never calls admin.from().

export type Admin = ReturnType<typeof createAdminClient>;
export type Row = Record<string, unknown>;

/** The `{ content, isError }` shape MCP tools return. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface HouseholdTool {
  name: string;
  description: string;
  /** Zod raw shape, as MCP's registerTool takes it. Absent for tools with no input. */
  inputSchema?: z.ZodRawShape;
  // Each handler's argument type is tied to its own inputSchema, which a
  // shared list type can't re-derive, so the list holds them untyped; each
  // tool() call site still type-checks its own handler literal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResult>;
}

export interface HouseholdToolContext {
  admin: Admin;
  userId: string;
  groupId: string | null;
  /** The household's switched-on modules; task tools hide reminders whose owner module is off. */
  enabled: ReadonlySet<ModuleId>;
  /** The device asking (cook mode sends it), so a timer the tools start rings there. */
  deviceId?: string | null;
  /**
   * The turn is in the household's shared chat, read by every member: tools
   * leave out anything kept from anyone (gift surprises) and every "Just me"
   * row, not just what is kept from this person.
   */
  shared?: boolean;
  /**
   * A device anyone in the room can hear: get_occasions gives what and when
   * only, and never reads gift ideas or wishlists. Use with shared.
   */
  occasionDatesOnly?: boolean;
}

export function ok(body: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

export const NO_GROUP = "No household group";

/** Drops empty fields so a row reads short. */
export function compact<T extends Row>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as Partial<T>;
}

/** Only the given fields of a row, leaving out empty ones. */
export function basic<T extends object>(row: T, keys: readonly (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.filter((k) => row[k] != null).map((k) => [k, row[k]])) as Partial<T>;
}

export const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// Read tools answer with the fields everyday questions need unless the agent
// asks for the full row: a household's whole list in every column runs to
// tens of thousands of characters. Basic keeps the id so the agent can still
// edit, and leaves out empty fields.
export const DETAIL = z
  .enum(["basic", "full"])
  .optional()
  .describe(
    "basic (default) answers everyday questions; a field missing from a basic row is empty. full adds bookkeeping fields (reminders, recipe links, price history, timestamps).",
  );

/** Everyone a to-do or event is for. */
export const PEOPLE = z
  .array(z.string())
  .max(20)
  .nullable()
  .optional()
  .describe("Everyone it is for, as household member user ids, first = the main person. [] or null = anyone.");

/** True when a list names someone outside the household. */
export async function notAllMembers(db: ToolData, ids: readonly string[] | null | undefined): Promise<boolean> {
  if (!ids || ids.length === 0) return false;
  const members = new Set(await db.memberIds());
  return [...new Set(ids)].some((id) => !members.has(id));
}

/** The person's today, in their time zone. */
export async function personToday(admin: Admin, userId: string): Promise<string> {
  return todayIn(await personTimeZone(admin, userId).catch(() => "UTC"));
}

/** Member names by user id; empty when they can't be read. */
export async function names(admin: Admin, groupId: string): Promise<Map<string, string>> {
  return memberNames(admin, groupId).catch(() => new Map<string, string>());
}

/** "you", a member's name, or "someone". */
export function who(id: string | null | undefined, userId: string, members: Map<string, string>): string | null {
  if (!id) return null;
  return id === userId ? "you" : (members.get(id) ?? "someone");
}

/**
 * Collects one tile's tools. Gives back `db` (household data under the
 * privacy rules) and `groupId` for the handlers. With no household a tool
 * answers `empty` (null: the NO_GROUP error) and its handler never runs, so
 * inside a handler `groupId` and `db` are always this household's.
 */
export function toolRegistrar(ctx: HouseholdToolContext) {
  const tools: HouseholdTool[] = [];
  const groupId = ctx.groupId ?? "";
  const db = toolData(ctx.admin, { userId: ctx.userId, groupId, shared: ctx.shared ?? false });

  function tool<S extends z.ZodRawShape>(
    name: string,
    config: { description: string; inputSchema?: S },
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
    empty: unknown = [],
  ) {
    tools.push({
      name,
      description: config.description,
      inputSchema: config.inputSchema,
      handler: (async (args: z.infer<z.ZodObject<S>>) => {
        if (!ctx.groupId) return empty === null ? fail(NO_GROUP) : ok(empty);
        try {
          return await handler(args);
        } catch (err) {
          return fail(err instanceof Error ? err.message : "Something went wrong");
        }
      }) as HouseholdTool["handler"],
    });
  }

  return { tools, tool, db, groupId };
}
