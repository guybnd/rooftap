import { z } from "zod";
import { groceryNeededAgainPatch, type GroceryItem } from "@homeup/core";
import { basic, DETAIL, fail, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";

// Groceries. A private item is its owner's (tool-data.ts).

const GROCERY_STATUSES: [GroceryItem["status"], ...GroceryItem["status"][]] = ["needed", "have", "bought"];
const GROCERY_BASIC = [
  "id",
  "name",
  "quantity",
  "unit",
  "aisle",
  "status",
  "notes",
  "is_essential",
  "expiry_date",
  "price_cents",
  "last_purchased_at",
] as const;

export function groceriesTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { userId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  tool(
    "get_grocery_items",
    {
      description:
        "Household grocery list items visible to the authenticated user. Pass status 'needed' for the shopping list; 'have' is the pantry stock, which is usually most of the list, so ask for it only when you need it. Pass search to find items by name in every status (to check whether something is already there).",
      inputSchema: {
        status: z.enum(["needed", "have", "bought"]).optional(),
        search: z.string().optional().describe("Part of a name, ignoring case; matches every status unless status is given."),
        detail: DETAIL,
      },
    },
    async ({ status, search, detail }) => {
      // In a chat the household shares, private items stay out, the asker's own too (tool-data.ts).
      const visible = (await db.rows<GroceryItem>("grocery_items"))
        .filter((i) => !status || i.status === status)
        .filter((i) => !search?.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()));
      const items = detail === "full" ? visible : visible.map((i) => basic(i, GROCERY_BASIC));
      return ok(items);
    },
  );

  tool(
    "create_grocery_item",
    {
      description:
        "Add an item to the household grocery list, attributed to the authenticated user. A name already on the list (any status, same name ignoring case) is not added twice: an item in stock (have or bought) goes back to needed, with the quantity, unit and notes given, and one already needed stays as it is. The result's `outcome` says which: added, back_on_list or already_needed.",
      inputSchema: {
        name: z.string().min(1),
        aisle: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        status: z.enum(GROCERY_STATUSES).optional(),
        notes: z.string().optional(),
        price_cents: z.number().int().nonnegative().optional(),
        shelf_life_days: z.number().int().nonnegative().optional(),
        expiry_date: z.string().optional(),
        is_essential: z.boolean().optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ name, aisle, quantity, unit, status, notes, price_cents, shelf_life_days, expiry_date, is_essential, private: isPrivate }) => {
      // Like the app's quick add: the list keeps every item, so a name already
      // there comes back to needed instead of being added twice.
      const [existing] = await db.rows<GroceryItem>("grocery_items", (q) =>
        q.ilike(
          "name",
          name.trim().replace(/[\\%_]/g, (c: string) => `\\${c}`),
        ),
      );
      if (existing) {
        if (existing.status === "needed") {
          return ok({ outcome: "already_needed", id: existing.id, name: existing.name });
        }
        const patch: Record<string, unknown> = { ...groceryNeededAgainPatch(new Date().toISOString()) };
        if (quantity !== undefined) patch.quantity = quantity;
        if (unit !== undefined) patch.unit = unit;
        if (notes !== undefined) patch.notes = notes;
        await db.update("grocery_items", existing.id, patch);
        return ok({ outcome: "back_on_list", id: existing.id, name: existing.name });
      }
      const row: Record<string, unknown> = {
        id: crypto.randomUUID(),
        group_id: groupId,
        name: name.trim(),
        aisle: aisle ?? "other",
        quantity: quantity ?? null,
        unit: unit ?? null,
        status: status ?? "needed",
        notes: notes ?? null,
        assigned_to: isPrivate ? userId : null,
        private: isPrivate ?? false,
        template_key: null,
        sort_order: 0,
        created_by: userId,
        updated_by: null,
        deleted: false,
        recurrence_days: null,
        status_changed_at: null,
        last_purchased_at: null,
        last_price: null,
        lowest_price: null,
        expiry_date: expiry_date ?? null,
        shelf_life_days: shelf_life_days ?? null,
        price_cents: price_cents ?? null,
        is_essential: is_essential ?? false,
        recipe_note: null,
        recipe_source_id: null,
        re_add_snoozed_until: null,
        re_add_dismissed_at: null,
      };
      await db.insert("grocery_items", row);
      return ok({ ...row, outcome: "added" });
    },
    null,
  );

  tool(
    "update_grocery_item",
    {
      description:
        "Update fields on an existing grocery list item (name, aisle, status, quantity, unit, notes, price, shelf life, expiry date, essential flag, private flag). Only the fields provided are changed; omit a field to leave it as-is.",
      inputSchema: {
        grocery_item_id: z.string(),
        name: z.string().min(1).optional(),
        aisle: z.string().optional(),
        quantity: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        status: z.enum(GROCERY_STATUSES).optional(),
        notes: z.string().nullable().optional(),
        price_cents: z.number().int().nonnegative().nullable().optional(),
        shelf_life_days: z.number().int().nonnegative().nullable().optional(),
        expiry_date: z.string().nullable().optional(),
        is_essential: z.boolean().optional(),
        private: z.boolean().optional(),
      },
    },
    async ({ grocery_item_id, ...patch }) => {
      const item = await db.row<GroceryItem>("grocery_items", grocery_item_id);
      if (!item) return fail("Grocery item not found");
      const updates: Record<string, unknown> = {};
      for (const key of [
        "name",
        "aisle",
        "quantity",
        "unit",
        "status",
        "notes",
        "price_cents",
        "shelf_life_days",
        "expiry_date",
        "is_essential",
        "private",
      ] as const) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      // A status change restarts the shelf-life clock, as in the app; back to needed clears the last buy.
      if (patch.status !== undefined && patch.status !== item.status) {
        updates.status_changed_at = new Date().toISOString();
        if (patch.status === "needed") updates.last_purchased_at = null;
      }
      if (Object.keys(updates).length > 0) {
        await db.update("grocery_items", grocery_item_id, updates);
      }
      return ok({ ok: true, id: grocery_item_id });
    },
    null,
  );

  tool(
    "delete_grocery_item",
    {
      description: "Soft-delete a grocery list item.",
      inputSchema: { grocery_item_id: z.string() },
    },
    async ({ grocery_item_id }) => {
      const item = await db.row<GroceryItem>("grocery_items", grocery_item_id);
      if (!item) return fail("Grocery item not found");
      await db.remove("grocery_items", grocery_item_id);
      return ok({ ok: true, id: grocery_item_id });
    },
    null,
  );

  return tools;
}
