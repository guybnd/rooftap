import { z } from "zod";
import {
  itemLink,
  buildChecklistItem,
  buildLoggedCost,
  checkItemPatch,
  completion,
  norm,
  uncheckItemPatch,
  type Checklist,
  type ChecklistTaskItem,
  buildChecklist,
  buildLinkedTask,
  instantiateTemplate,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type ChecklistType,
} from "@homeup/core";
import { basic, fail, ISO_DATE, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";

// Checklists: packing, cleaning and shopping lists, and their templates.

export function checklistsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { userId, enabled } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  tool(
    "get_checklists",
    {
      description:
        "The household's checklists (packing, cleaning, shopping runs and so on) with their items. Open lists only unless include_completed is true; pass checklist_id for one list.",
      inputSchema: {
        checklist_id: z.string().optional(),
        include_completed: z.boolean().optional(),
      },
    },
    async ({ checklist_id, include_completed }) => {
      const listRows = await db.rows<Checklist>("checklists", (q) => (checklist_id ? q.eq("id", checklist_id) : q));
      const lists = listRows.filter((l) => checklist_id || include_completed || !l.completed_at);
      if (checklist_id && lists.length === 0) return fail("Checklist not found");
      const ids = lists.map((l) => l.id);
      const itemRows = ids.length ? await db.rows<ChecklistTaskItem>("checklist_task_items", (q) => q.in("checklist_id", ids)) : [];
      const byList = new Map<string, ChecklistTaskItem[]>();
      for (const item of itemRows.sort((a, b) => a.order - b.order)) {
        byList.set(item.checklist_id, [...(byList.get(item.checklist_id) ?? []), item]);
      }
      const rows = lists.map((l) => ({
        ...basic(l, ["id", "title", "type", "scheduled_date", "completed_at"] as const),
        items: (byList.get(l.id) ?? []).map((i) => basic(i, ["id", "label", "is_done", "cost_cents"] as const)),
        link: itemLink("checklist", l.id),
      }));
      return ok(rows);
    },
  );

  tool(
    "add_checklist_item",
    {
      description: "Add an item to the end of a checklist.",
      inputSchema: {
        checklist_id: z.string(),
        label: z.string().min(1),
        cost_cents: z.number().int().nonnegative().optional(),
      },
    },
    async ({ checklist_id, label, cost_cents }) => {
      const list = await db.row<Checklist>("checklists", checklist_id);
      if (!list) return fail("Checklist not found");
      const items = await db.rows<ChecklistTaskItem>("checklist_task_items", (q) => q.eq("checklist_id", list.id));
      const row = buildChecklistItem({
        checklistId: list.id,
        groupId,
        label,
        order: items.reduce((max, i) => Math.max(max, i.order), -1) + 1,
        costCents: cost_cents ?? null,
      });
      await db.insert("checklist_task_items", row);
      // A finished list that gains an item is open again, as in the app.
      if (list.completed_at && list.type !== "repeating") {
        await db.update("checklists", list.id, { completed_at: null });
        if (list.linked_task_id) await db.update("household_tasks", list.linked_task_id, { done: false, completed_at: null });
      }
      return ok({
        ok: true,
        id: row.id,
        checklist: list.title,
      });
    },
    null,
  );

  tool(
    "check_checklist_item",
    {
      description:
        "Tick (or with done false, untick) a checklist item. Ticking the last open item completes the list and its linked to-do, and a priced item on a shopping list logs its cost, the same as ticking it in the app.",
      inputSchema: {
        item_id: z.string(),
        done: z.boolean().optional(),
      },
    },
    async ({ item_id, done = true }) => {
      const item = await db.row<ChecklistTaskItem>("checklist_task_items", item_id);
      if (!item) return fail("Checklist item not found");
      const list = await db.row<Checklist>("checklists", item.checklist_id);
      if (!list) return fail("Checklist not found");
      if (item.is_done === done) return ok({ ok: true, id: item.id, unchanged: true });

      const patch: Record<string, unknown> = done ? checkItemPatch(userId) : uncheckItemPatch();
      if (
        done &&
        enabled.has("costs") &&
        list.type === "shopping" &&
        list.log_costs &&
        (item.cost_cents ?? 0) > 0 &&
        !item.linked_cost_item_id
      ) {
        const cost = buildLoggedCost({
          item,
          checklist: list,
          createdBy: userId,
        });
        await db.insert("cost_items", cost);
        patch.linked_cost_item_id = cost.id;
      } else if (!done && item.linked_cost_item_id) {
        await db.remove("cost_items", item.linked_cost_item_id);
        patch.linked_cost_item_id = null;
      }
      await db.update("checklist_task_items", item.id, patch);

      // Completion sync, as useChecklistToggle does in the apps.
      const siblings = await db.rows<ChecklistTaskItem>("checklist_task_items", (q) => q.eq("checklist_id", list.id));
      const projected = siblings.map((i) => (i.id === item.id ? { ...i, is_done: done } : i));
      const { complete } = completion(projected);
      const now = new Date().toISOString();
      if (list.linked_task_id) {
        await db.update(
          "household_tasks",
          list.linked_task_id,
          complete ? { done: true, completed_at: now } : { done: false, completed_at: null },
        );
      }
      if (list.type !== "repeating" && complete !== !!list.completed_at) {
        await db.update("checklists", list.id, { completed_at: complete ? now : null });
      }
      return ok({
        ok: true,
        id: item.id,
        checklist_complete: complete,
      });
    },
    null,
  );

  tool(
    "get_checklist_templates",
    {
      description:
        "Checklists: the household's templates (packing, cleaning and so on) with their items, to start a new list from with create_checklist.",
    },
    async () => {
      const [templates, items] = await Promise.all([
        db.rows<ChecklistTemplate>("checklist_templates"),
        db.rows<ChecklistTemplateItem>("checklist_template_items"),
      ]);
      return ok(
        templates.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.default_type ?? "plain",
          items: items
            .filter((i) => i.template_id === t.id)
            .sort((a, b) => a.order - b.order)
            .map((i) => i.label),
        })),
      );
    },
  );

  tool(
    "create_checklist",
    {
      description:
        "Checklists: start a new list, either from a template (template_id from get_checklist_templates, which copies its items) or with a title and items. type is plain, shopping (items can have a cost) or repeating. scheduled_date (YYYY-MM-DD) also puts a linked to-do on that day, as in the app. Extra items are added after the template's.",
      inputSchema: {
        title: z.string().min(1).max(200).optional(),
        template_id: z.string().optional(),
        items: z.array(z.string().min(1).max(300)).max(200).optional(),
        type: z.enum(["plain", "shopping", "repeating"]).optional(),
        scheduled_date: ISO_DATE.optional(),
      },
    },
    async ({ title, template_id, items, type, scheduled_date }) => {
      let checklist: Checklist;
      let rows: ReturnType<typeof buildChecklistItem>[] = [];
      if (template_id) {
        const template = await db.row<ChecklistTemplate>("checklist_templates", template_id);
        if (!template) return fail("Template not found");
        const tItems = await db.rows<ChecklistTemplateItem>("checklist_template_items");
        ({ checklist, items: rows } = instantiateTemplate({
          template,
          items: tItems.filter((i) => i.template_id === template.id),
          scheduledDate: scheduled_date ?? null,
          createdBy: userId,
        }));
        if (title?.trim()) checklist.title = title.trim();
        if (type) checklist.type = type as ChecklistType;
      } else {
        if (!title?.trim()) return fail("Pass a title or a template_id.");
        checklist = buildChecklist({
          groupId: groupId,
          title,
          type: (type ?? "plain") as ChecklistType,
          scheduledDate: scheduled_date ?? null,
          createdBy: userId,
        });
      }
      for (const label of items ?? []) {
        if (rows.some((r) => norm(r.label) === norm(label))) continue;
        rows.push(buildChecklistItem({ checklistId: checklist.id, groupId: groupId, label, order: rows.length }));
      }
      const task = checklist.scheduled_date && enabled.has("household") ? buildLinkedTask({ checklist, createdBy: userId }) : null;
      if (task) checklist.linked_task_id = task.id;
      await db.insert("checklists", checklist);
      if (rows.length) {
        await db.insert("checklist_task_items", rows);
      }
      if (task) await db.insert("household_tasks", { ...task, assigned_to: userId });
      return ok({
        ok: true,
        id: checklist.id,
        title: checklist.title,
        items: rows.length,
        ...(task ? { task_id: task.id } : {}),
        link: itemLink("checklist", checklist.id),
      });
    },
    null,
  );

  return tools;
}
