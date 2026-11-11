import { z } from "zod";
import { norm, type SetupItem } from "@homeup/core";
import { basic, fail, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext, type Row } from "../tool-kit";

// Home Setup: what the household is buying or installing, by room. A
// private item is its owner's (tool-data.ts).

export function setupTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { userId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  const PRICE = z.number().int().nonnegative();

  tool(
    "get_setup_items",
    {
      description:
        "Home Setup: the things the household is buying or installing for the home, by room, with priority and prices (amounts in cents). Pass status 'needed' for what is still to get.",
      inputSchema: {
        status: z.enum(["needed", "installed"]).optional(),
        room: z.string().optional(),
      },
    },
    async ({ status, room }) => {
      const rows = (await db.rows<SetupItem>("setup_items"))
        .filter((i) => (!status || i.status === status) && (!room || norm(i.room) === norm(room)))
        .map((i) =>
          basic(i, ["id", "name", "room", "status", "priority", "est_price", "actual_price", "where_to_buy", "url", "notes"] as const),
        );
      return ok(rows);
    },
  );

  tool(
    "create_setup_item",
    {
      description:
        'Home Setup: add something the household needs to buy or install for the home, in a room ("a curtain rail for the bedroom"). Prices in cents. private true keeps it to this person.',
      inputSchema: {
        name: z.string().min(1).max(200),
        room: z.string().min(1).max(100),
        priority: z.enum(["low", "medium", "high"]).optional(),
        est_price: PRICE.optional(),
        where_to_buy: z.string().max(200).optional(),
        url: z.string().url().optional(),
        notes: z.string().max(1000).optional(),
        private: z.boolean().optional(),
      },
    },
    async (args) => {
      const items = await db.rows<SetupItem>("setup_items");
      const row = {
        id: crypto.randomUUID(),
        group_id: groupId,
        name: args.name.trim(),
        room: args.room.trim(),
        priority: args.priority ?? "medium",
        status: "needed",
        est_price: args.est_price ?? null,
        actual_price: null,
        where_to_buy: args.where_to_buy?.trim() || null,
        store_id: null,
        url: args.url ?? null,
        notes: args.notes?.trim() || null,
        // A private item is its owner's: the read hides it from everyone else.
        assigned_to: args.private ? userId : null,
        private: args.private ?? false,
        template_key: null,
        ai_suggestion: null,
        sort_order: items.reduce((max, i) => Math.max(max, i.sort_order ?? 0), -1) + 1,
        created_by: userId,
        deleted: false,
      };
      await db.insert("setup_items", row);
      return ok({ ok: true, id: row.id, name: row.name, room: row.room });
    },
    null,
  );

  tool(
    "update_setup_item",
    {
      description:
        "Home Setup: change an item (id from get_setup_items). status installed marks it got or done, needed puts it back. Prices in cents (null clears). Only the fields given change.",
      inputSchema: {
        item_id: z.string(),
        name: z.string().min(1).max(200).optional(),
        room: z.string().min(1).max(100).optional(),
        status: z.enum(["needed", "installed"]).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        est_price: PRICE.nullable().optional(),
        actual_price: PRICE.nullable().optional(),
        where_to_buy: z.string().max(200).nullable().optional(),
        url: z.string().url().nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
      },
    },
    async ({ item_id, ...fields }) => {
      const item = await db.row<SetupItem>("setup_items", item_id);
      if (!item) return fail("Setup item not found");
      const patch: Row = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = typeof v === "string" ? v.trim() || null : v;
      if (Object.keys(patch).length === 0) return fail("Nothing to change.");
      await db.update("setup_items", item.id, patch);
      return ok({ ok: true, id: item.id, name: (patch.name as string) ?? item.name, status: (patch.status as string) ?? item.status });
    },
    null,
  );

  return tools;
}
