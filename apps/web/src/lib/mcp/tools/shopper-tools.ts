import { z } from "zod";
import {
  itemLink,
  aiBlockedMessage,
  parseScoutBrief,
  scoutLatestRun,
  scoutRunStatus,
  scoutTitle,
  SCOUT_BRIEF_MAX,
  type Group,
  norm,
  cleanKeepFrom,
  type ShopperWant,
} from "@homeup/core";
import { hasOfferSources, scoutBrain, startScoutRun } from "@/lib/shopper/scout";
import { readThread } from "@/lib/shopper/scout-thread";
import { basic, fail, ISO_DATE, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext, type Row } from "../tool-kit";
import { canSee } from "../tool-data";

// Shopper: the watchlist and Scout. A watch or search kept from this person
// (a present) never shows (tool-data.ts). Scout runs the same as one
// started in Shopper, with the same key, plan and allowance checks.

export function shopperTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId, shared = false } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  tool(
    "get_watchlist",
    {
      description:
        "Shopper: things the household wants to buy, with the target and budget and the best price found so far (amounts in cents). Watching and idea items unless status says otherwise.",
      inputSchema: {
        status: z.enum(["watching", "idea", "bought"]).optional(),
      },
    },
    async ({ status }) => {
      const rows = (await db.rows<ShopperWant>("shopper_wants"))
        .filter((w) => (status ? w.status === status : w.status !== "bought"))
        .map((w) => ({
          ...basic(w, [
            "id",
            "title",
            "status",
            "target_cents",
            "budget_cents",
            "best_cents",
            "best_store",
            "need_by",
            "last_checked_at",
            "notes",
          ] as const),
          link: itemLink("watch", w.id),
        }));
      return ok(rows);
    },
  );

  tool(
    "watch_item",
    {
      description:
        'Shopper: add something to the watchlist so Rooftap checks its price every day and says when it reaches the target. Use it for "tell me when X drops under $Y". Amounts in cents. status idea keeps it on the list without price checks. keep_from_user_ids keeps it (and its prices) from those members, for a present; not in the household\'s shared chat. Use start_scout instead when they want someone to research what to buy.',
      inputSchema: {
        title: z.string().min(1).max(200),
        query: z.string().max(200).optional().describe("What to search the stores for, when it differs from the title."),
        target_cents: z.number().int().positive().optional(),
        budget_cents: z.number().int().positive().optional(),
        need_by: ISO_DATE.optional(),
        notes: z.string().max(1000).optional(),
        status: z.enum(["watching", "idea"]).optional(),
        keep_from_user_ids: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ title, query, target_cents, budget_cents, need_by, notes, status, keep_from_user_ids }) => {
      if (shared && keep_from_user_ids?.length)
        return fail("Surprises can't be planned in the household chat, where everyone reads it. Ask in a private chat.");
      const keepFrom = cleanKeepFrom(keep_from_user_ids, await db.memberIds(), userId);
      if (!keepFrom) return fail("Someone in keep_from_user_ids is not in this household");
      const wants = await db.rows<ShopperWant>("shopper_wants");
      const dupe = wants.find((w) => w.status !== "bought" && norm(w.title) === norm(title));
      if (dupe) return fail(`${dupe.title} is already on the watchlist (id ${dupe.id}); use update_watch_item.`);
      const row = {
        id: crypto.randomUUID(),
        group_id: groupId,
        title: title.trim(),
        query: query?.trim() || null,
        target_cents: target_cents ?? null,
        budget_cents: budget_cents ?? null,
        status: status ?? "watching",
        need_by: need_by ?? null,
        notes: notes?.trim() || null,
        ...(keepFrom.length ? { hidden_from: keepFrom } : {}),
        created_by: userId,
        deleted: false,
      };
      await db.insert("shopper_wants", row);
      return ok({ ok: true, id: row.id, title: row.title, status: row.status, link: itemLink("watch", row.id) });
    },
    null,
  );

  tool(
    "update_watch_item",
    {
      description:
        "Shopper: change a watchlist item (id from get_watchlist): its target or budget (cents, null clears), need-by date, notes, or status (watching, idea, or bought once they have it). remove true takes it off the list.",
      inputSchema: {
        want_id: z.string(),
        title: z.string().min(1).max(200).optional(),
        target_cents: z.number().int().positive().nullable().optional(),
        budget_cents: z.number().int().positive().nullable().optional(),
        need_by: ISO_DATE.nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        status: z.enum(["watching", "idea", "bought"]).optional(),
        remove: z.boolean().optional(),
      },
    },
    async ({ want_id, remove, ...fields }) => {
      const want = await db.row<ShopperWant>("shopper_wants", want_id);
      if (!want) return fail("Watchlist item not found");
      const patch: Row = remove ? { deleted: true } : {};
      if (!remove) {
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = typeof v === "string" ? v.trim() || null : v;
        if (fields.status === "bought" && want.status !== "bought") patch.bought_at = new Date().toISOString();
        if (fields.status && fields.status !== "bought") patch.bought_at = null;
      }
      if (Object.keys(patch).length === 0) return fail("Nothing to change.");
      await db.update("shopper_wants", want.id, patch);
      return ok({ ok: true, id: want.id, title: (patch.title as string) ?? want.title, ...(remove ? { removed: true } : {}) });
    },
    null,
  );

  tool(
    "start_scout",
    {
      description:
        "Shopper: start a Scout search, an AI researcher that checks the household's price sources and comes back with up to three picks in about a minute. Use it when someone asks you to find, research or shop for something to buy. Budget in whole currency units. Tell them it's researching and link the run (link field) so they can open it; they get a notification when it's done. Read the picks later with get_scout_run. keep_from_user_ids keeps the search, its picks and any watch made from it from those members, for a present; not in the household's shared chat.",
      inputSchema: {
        text: z.string().min(3).max(SCOUT_BRIEF_MAX).describe("What they want, in their own words, with any must-haves."),
        budget_max: z.number().positive().optional(),
        budget_min: z.number().positive().optional(),
        need_by: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        where: z.array(z.enum(["nearby", "online", "secondhand"])).optional(),
        keep_from_user_ids: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ text, budget_max, budget_min, need_by, where, keep_from_user_ids }) => {
      if (shared && keep_from_user_ids?.length) {
        return fail("Surprises can't be planned in the household chat, where everyone reads it. Ask in a private chat.");
      }
      const keepFrom = cleanKeepFrom(keep_from_user_ids, await db.memberIds(), userId);
      if (!keepFrom) return fail("Someone in keep_from_user_ids is not in this household");
      const parsed = parseScoutBrief({
        text,
        budget_max_cents: budget_max ? Math.round(budget_max * 100) : null,
        budget_min_cents: budget_min ? Math.round(budget_min * 100) : null,
        need_by,
        where,
      });
      if ("error" in parsed) return fail(parsed.error);
      const group = await db.group<Group>();
      if (!group) return fail("No household.");
      const decided = await scoutBrain(admin, groupId);
      if ("blocked" in decided) return fail(aiBlockedMessage(decided.blocked));
      if (!(await hasOfferSources(group as Group)))
        return fail("No price sources are set up on this server, so Scout has nothing to search.");
      const run = await startScoutRun(admin, group as Group, userId, parsed.brief, decided.brain, { hiddenFrom: keepFrom });
      if (!run) return fail("Could not start Scout.");
      return ok({
        id: run.id,
        status: "running",
        title: scoutTitle(run.brief),
        link: itemLink("scout", run.id),
      });
    },
    null,
  );

  tool(
    "get_scout_run",
    {
      description:
        "Shopper: a Scout search and its newest picks (prices in cents), with why each fits. Without an id, the household's latest search. status running means it is still researching.",
      inputSchema: { id: z.string().uuid().optional() },
    },
    async ({ id }) => {
      let runId = id ?? null;
      if (!runId) {
        const searches = await db.rows<{ id: string }>(
          "shopper_searches",
          (q) => q.order("created_at", { ascending: false }).limit(20),
          "id",
        );
        runId = searches[0]?.id ?? null;
      }
      if (!runId) return fail("No Scout searches yet.");
      const thread = await readThread(admin, runId);
      const latest = thread ? scoutLatestRun(thread) : null;
      const root = thread?.runs.find((r) => !r.thread_id) ?? latest;
      if (!thread || !latest || !root || latest.group_id !== groupId || !canSee("shopper_searches", root, db.viewer))
        return fail("Scout search not found.");
      const picks = thread.picks
        .filter((p) => p.search_id === latest.id)
        .map((p) => basic(p, ["rank", "title", "price_cents", "currency", "store", "url", "in_stock", "stretch", "label", "why"] as const));
      return ok({
        id: latest.id,
        status: scoutRunStatus(latest),
        brief: latest.brief,
        error: latest.error,
        picks,
        link: itemLink("scout", root.id),
      });
    },
    null,
  );

  return tools;
}
