import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { HouseholdTool, ToolResult } from "./household-tools";

// The shared parts of a module's household tools: the result shapes, the
// group-scoped row read and the tool() registrar that answers "no household"
// and turns a thrown error into a tool error. module-tools.ts and each
// tools/<module>-tools.ts file (scripts/new-module.mjs writes one) use it.
// The admin client skips RLS, so every read is scoped to the group by hand
// and repeats the module's privacy rule.

export type Admin = ReturnType<typeof createAdminClient>;
export type Row = Record<string, unknown>;

export function ok(body: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

export const NO_GROUP = "No household group";

/** Drops empty fields so a row reads short. */
export function compact<T extends Row>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))) as Partial<T>;
}

/** A group's rows that are not deleted. */
export async function liveRows<T>(admin: Admin, table: string, groupId: string): Promise<T[]> {
  const { data, error } = await admin.from(table).select("*").eq("group_id", groupId).eq("deleted", false);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/**
 * Collects a list of tools. Each handler gets the household's id; with no
 * household the tool answers `empty` (null: the NO_GROUP error).
 */
export function toolRegistrar(groupId: string | null) {
  const tools: HouseholdTool[] = [];

  function tool<S extends z.ZodRawShape>(
    name: string,
    config: { description: string; inputSchema?: S },
    handler: (args: z.infer<z.ZodObject<S>>, groupId: string) => Promise<ToolResult>,
    empty: unknown = [],
  ) {
    tools.push({
      name,
      description: config.description,
      inputSchema: config.inputSchema,
      handler: (async (args: z.infer<z.ZodObject<S>>) => {
        if (!groupId) return empty === null ? fail(NO_GROUP) : ok(empty);
        try {
          return await handler(args, groupId);
        } catch (err) {
          return fail(err instanceof Error ? err.message : "Something went wrong");
        }
      }) as HouseholdTool["handler"],
    });
  }

  return { tools, tool };
}
