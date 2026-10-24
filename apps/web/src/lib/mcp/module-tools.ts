import { z } from "zod";
import {
  addDaysISO,
  binCollections,
  binNightState,
  binNamesPhrase,
  brandKey,
  buildChecklist,
  buildChecklistItem,
  buildLinkedTask,
  buildRecipe,
  buildRecipeIngredient,
  buildRewardPerk,
  CARE_AREAS,
  careDonePatch,
  careDue,
  careEveryLabel,
  careJobFromSuggestion,
  careSkipPatch,
  careSnoozePatch,
  careStatePatch,
  careSuggestionsFor,
  cardExpiryCaption,
  cardsForStore,
  cardTitle,
  costInsights,
  costTargets,
  dishesTitle,
  folderBreadcrumb,
  householdCurrency,
  instantiateTemplate,
  instructionsFromSteps,
  cleanKeepFrom,
  isKeptFrom,
  isSouthernHemisphere,
  liveCareJobs,
  loyaltyNumberTail,
  mealDishesByDate,
  monthKeys,
  newCareJobFields,
  norm,
  perksEndingSoon,
  perkValueLabel,
  sortByDue,
  type Apartment,
  type Appointment,
  type BinChange,
  type BinPlan,
  type BinStream,
  type CareArea,
  type CareJob,
  type CareUnit,
  type Checklist,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type ChecklistType,
  type Document,
  type DocumentFolder,
  type LoyaltyCard,
  type MealPlanEntry,
  type Recipe,
  type RecipeMethod,
  type RewardPartner,
  type RewardPerk,
  type RewardScheme,
  type SetupItem,
  type ShopperWant,
  nextOccasionDay,
  occasionTitle,
  type Occasion,
  itemLink,
} from "@homeup/core";
import { memberNames } from "@/lib/member-names";
import { personTimeZone, todayIn } from "@/lib/meal-plan-server";
import { householdCostMonths } from "@/lib/cost-month-server";
import type { HouseholdTool, HouseholdToolContext } from "./household-tools";
import { compact, fail, ISO_DATE, liveRows, ok, toolRegistrar, type Admin, type Row } from "./tool-kit";

// The household tools for the modules that came after the first set: Rewards,
// Bin night, Home care, Shopper's watchlist, new checklists, saving a recipe,
// Home Setup changes, Documents, Home Search and Money insights. Same rules as
// household-tools.ts: the admin client skips RLS, so every read is scoped to
// the group by hand and repeats the module's privacy rule (another member's
// private loyalty card or Setup item, a watch kept from this person).
// Each tool's module is in MCP_TOOLS (core mcp-tools.ts), which gates it.

async function personToday(admin: Admin, userId: string): Promise<string> {
  return todayIn(await personTimeZone(admin, userId).catch(() => "UTC"));
}

async function names(admin: Admin, groupId: string): Promise<Map<string, string>> {
  return memberNames(admin, groupId).catch(() => new Map<string, string>());
}

function who(id: string | null | undefined, userId: string, members: Map<string, string>): string | null {
  if (!id) return null;
  return id === userId ? "you" : (members.get(id) ?? "someone");
}


// ── Shared reads for get_agenda ─────────────────────────────────────────────

/**
 * What the newer modules add to get_agenda between `today` and `last`: bin
 * nights, Home care jobs due, and the planned dinners. Each part only while
 * its module is on, and a part that fails is left out rather than failing
 * the whole agenda.
 */
export async function agendaExtras(
  ctx: Pick<HouseholdToolContext, "admin" | "userId" | "enabled" | "shared"> & { groupId: string },
  today: string,
  last: string,
): Promise<Row> {
  const { admin, userId, groupId, enabled, shared = false } = ctx;
  const out: Row = {};
  const needNames = enabled.has("bins") || enabled.has("meals");
  const members = needNames ? await names(admin, groupId) : new Map<string, string>();
  await Promise.all([
    enabled.has("bins") &&
      binData(admin, groupId)
        .then(({ streams, changes, plan }) => {
          const nights = binCollections(streams, changes, addDaysISO(today, 1), addDaysISO(last, 1));
          const state = binNightState(streams, changes, plan, today);
          if (nights.length === 0) return;
          out.bin_nights = nights.map((c) => ({
            night_of: addDaysISO(c.date, -1),
            collection: c.date,
            bins: binNamesPhrase(c.streams),
            ...(state.collection?.date === c.date && state.out ? { out: true } : {}),
            ...(c.notes.length ? { notes: c.notes } : {}),
          }));
        })
        .catch(() => {}),
    enabled.has("home-care") &&
      liveRows<CareJob>(admin, "care_jobs", groupId)
        .then((rows) => {
          const due = sortByDue(liveCareJobs(rows)).filter((j) => j.state === "active" && j.next_due && j.next_due <= last);
          if (due.length === 0) return;
          out.home_care = due.map((j) => compact({ id: j.id, title: j.title, room: j.room, due: j.next_due, overdue: j.next_due! < today || undefined }));
        })
        .catch(() => {}),
    enabled.has("meals") &&
      enabled.has("recipes") &&
      Promise.all([liveRows<MealPlanEntry>(admin, "meal_plan_entries", groupId), liveRows<Recipe>(admin, "recipes", groupId)])
        .then(([entries, recipes]) => {
          const byId = new Map(recipes.map((r) => [r.id, r]));
          const nights = [...mealDishesByDate(entries.filter((e) => e.date >= today && e.date <= last))].sort(([a], [b]) => a.localeCompare(b));
          if (nights.length === 0) return;
          out.dinners = nights.map(([date, dishes]) =>
            compact({
              date,
              dinner: dishesTitle(dishes, byId) ?? dishes.find((d) => d.label)?.label ?? null,
              cook: who(dishes.find((d) => d.cook_user_id)?.cook_user_id, userId, members),
            }),
          );
        })
        .catch(() => {}),
    // Birthdays and other days. Kept ones stay out like in get_occasions; gift ideas never show here.
    enabled.has("occasions") &&
      liveRows<Occasion>(admin, "occasions", groupId)
        .then((rows) => {
          const days = rows
            .filter((o) => !(o.hidden_from ?? []).includes(userId) && !(shared && (o.hidden_from ?? []).length > 0))
            .map((o) => ({ o, day: nextOccasionDay(o, today) }))
            .filter((x): x is { o: Occasion; day: string } => !!x.day && x.day <= last)
            .sort((a, b) => a.day.localeCompare(b.day));
          if (days.length === 0) return;
          out.occasions = days.map(({ o, day }) => ({ id: o.id, title: occasionTitle(o, userId), date: day, kind: o.kind }));
        })
        .catch(() => {}),
  ]);
  return out;
}

async function binData(admin: Admin, groupId: string) {
  const [streams, changes, plans] = await Promise.all([
    liveRows<BinStream>(admin, "bin_streams", groupId),
    liveRows<BinChange>(admin, "bin_changes", groupId),
    liveRows<BinPlan>(admin, "bin_plans", groupId),
  ]);
  return { streams, changes, plan: plans[0] ?? null };
}

// ── The tools ───────────────────────────────────────────────────────────────

export function moduleTools({ admin, userId, groupId, enabled, shared = false }: HouseholdToolContext): HouseholdTool[] {
  // A watch kept from this person, or in the household's shared chat from anyone (Occasions).
  const keptHere = (w: ShopperWant) => isKeptFrom(w, userId) || (shared && (w.hidden_from ?? []).length > 0);
  const { tools, tool } = toolRegistrar(groupId);

  // ── Rewards ───────────────────────────────────────────────────────────────

  async function rewardsData(gid: string) {
    const [schemes, partners, perks, cards] = await Promise.all([
      liveRows<RewardScheme>(admin, "reward_schemes", gid),
      liveRows<RewardPartner>(admin, "reward_partners", gid),
      liveRows<RewardPerk>(admin, "reward_perks", gid),
      liveRows<LoyaltyCard>(admin, "loyalty_cards", gid),
    ]);
    // "Just me" cards belong to whoever made them (the RLS rule, by hand).
    return { schemes, partners, perks, cards: cards.filter((c) => !c.private || c.created_by === userId) };
  }

  function cardRow(card: LoyaltyCard, scheme: RewardScheme | null | undefined, today: string, members: Map<string, string>) {
    return compact({
      name: cardTitle(card, scheme),
      // Never the whole number: the app shows the barcode at the till.
      number: loyaltyNumberTail(card.number),
      owner: who(card.created_by, userId, members),
      just_me: card.private || undefined,
      expiry: cardExpiryCaption(card.expires_on, today),
    });
  }

  async function moneySymbol(gid: string): Promise<string> {
    const { data } = await admin.from("groups").select("region, currency").eq("id", gid).maybeSingle();
    const currency = householdCurrency(data as { region?: string | null; currency?: string | null } | null);
    // currency.ts is client-only, so the symbol comes straight from Intl.
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
    } catch {
      return currency;
    }
  }

  function perkRow(perk: RewardPerk, partners: RewardPartner[], today: string, symbol: string) {
    return compact({
      title: perk.title,
      value: perkValueLabel(perk, symbol),
      store: perk.partner_id ? (partners.find((p) => p.id === perk.partner_id)?.name ?? null) : "every partner store",
      conditions: perk.conditions,
      ends: perk.valid_until,
      ending_soon: perk.valid_until ? perk.valid_until <= addDaysISO(today, 30) || undefined : undefined,
    });
  }

  tool(
    "get_rewards",
    {
      description:
        "Rewards: loyalty cards, memberships and the perks they get the household. Pass store (a shop's name) for which cards and schemes work there, best perk first: use it for \"which card do I use at Bunnings?\". Without store: the household's cards, and perks ending in the next 30 days. Cards show only the last digits of the number (the app shows the barcode). Another member's \"Just me\" cards are never included.",
      inputSchema: {
        store: z.string().optional(),
      },
    },
    async ({ store }, gid) => {
      const [data, today, members, symbol] = await Promise.all([rewardsData(gid), personToday(admin, userId), names(admin, gid), moneySymbol(gid)]);
      const schemeOf = (id: string | null | undefined) => data.schemes.find((s) => s.id === id);
      if (store?.trim()) {
        const matches = cardsForStore(store, data, today);
        return ok({
          store: store.trim(),
          matches: matches.map((m) =>
            compact({
              scheme: m.scheme.name,
              cards: m.cards.map((c) => cardRow(c, m.scheme, today, members)),
              has_card: m.cards.length > 0,
              partner_stores: m.partners.map((p) => p.name),
              perks: m.perks.slice(0, 5).map((p) => perkRow(p, data.partners, today, symbol)),
            }),
          ),
        });
      }
      return ok({
        cards: data.cards.map((c) => cardRow(c, schemeOf(c.scheme_id), today, members)),
        schemes: data.schemes.map((s) => compact({ id: s.id, name: s.name, kind: s.kind, stores: data.partners.filter((p) => p.scheme_id === s.id).length })),
        perks_ending_soon: perksEndingSoon(data.perks.filter((p) => !p.deleted), today).map((p) => ({
          scheme: schemeOf(p.scheme_id)?.name ?? null,
          ...perkRow(p, data.partners, today, symbol),
        })),
      });
    },
    { cards: [], schemes: [], perks_ending_soon: [] },
  );

  tool(
    "add_reward_perk",
    {
      description:
        "Rewards: save a perk a scheme gives (\"Flybuys: 10% off at Kmart until Sunday\"). scheme is the scheme's name or id from get_rewards. store limits it to one partner store; leave it out for every store. kind is percent (value 10 for 10%), amount (value in whole currency units), points (value is the multiplier), freebie or other. valid_until is the last day it applies.",
      inputSchema: {
        scheme: z.string().min(1),
        title: z.string().min(1).max(200),
        kind: z.enum(["percent", "amount", "points", "freebie", "other"]).optional(),
        value: z.number().nonnegative().optional(),
        store: z.string().optional(),
        conditions: z.string().max(500).optional(),
        valid_until: ISO_DATE.optional(),
      },
    },
    async ({ scheme, title, kind, value, store, conditions, valid_until }, gid) => {
      const data = await rewardsData(gid);
      const key = brandKey(scheme);
      const s = data.schemes.find((x) => x.id === scheme) ?? data.schemes.find((x) => brandKey(x.name) === key);
      if (!s) return fail(`No scheme called ${scheme}. Schemes: ${data.schemes.map((x) => x.name).join(", ") || "none yet"}.`);
      let partnerId: string | null = null;
      if (store?.trim()) {
        const k = brandKey(store);
        const partner = data.partners.find((p) => p.scheme_id === s.id && brandKey(p.name) === k);
        if (!partner) return fail(`${store} isn't one of ${s.name}'s partner stores.`);
        partnerId = partner.id;
      }
      const perk: Row = buildRewardPerk({
        id: crypto.randomUUID(),
        groupId: gid,
        schemeId: s.id,
        partnerId,
        title,
        kind: kind ?? (value != null ? "percent" : "other"),
        value: value ?? null,
        conditions: conditions ?? null,
        validUntil: valid_until ?? null,
      }) as unknown as Row;
      // The builder leaves the timestamps blank for the app's sync to fill; the database does it here.
      delete perk.created_at;
      delete perk.updated_at;
      const row = { ...perk, created_by: userId } as unknown as RewardPerk;
      const { error } = await admin.from("reward_perks").insert(row);
      if (error) return fail(error.message);
      return ok({ ok: true, id: row.id, scheme: s.name, title: row.title });
    },
    null,
  );

  // ── Bin night ─────────────────────────────────────────────────────────────

  tool(
    "get_bin_night",
    {
      description:
        "Bin night: which bins go out next, whether tonight is bin night, whether they are already out, and whose turn it is, then the collections after that. Collections are the mornings the truck comes; the bins go out the night before (night_of). Changes such as a public holiday move are already applied. stream ids are for change_bin_collection.",
      inputSchema: {
        weeks: z.number().int().min(1).max(8).optional().describe("How many weeks of collections to list; 3 when left out."),
      },
    },
    async ({ weeks }, gid) => {
      const [{ streams, changes, plan }, today, members] = await Promise.all([binData(admin, gid), personToday(admin, userId), names(admin, gid)]);
      if (streams.length === 0) return ok({ set_up: false });
      const state = binNightState(streams, changes, plan, today);
      const upcoming = binCollections(streams, changes, today, addDaysISO(today, (weeks ?? 3) * 7));
      return ok({
        set_up: true,
        next: state.collection
          ? compact({
              collection: state.collection.date,
              night_of: state.nightOf,
              tonight: state.tonight,
              bins: binNamesPhrase(state.collection.streams),
              out: state.out,
              out_by: state.out ? who(plan?.out_by, userId, members) : null,
              turn: who(state.turn, userId, members),
              notes: state.collection.notes,
            })
          : null,
        upcoming: upcoming.map((c) =>
          compact({
            collection: c.date,
            bins: binNamesPhrase(c.streams),
            moved: c.moved.length ? c.moved.map((m) => ({ bin: streams.find((s) => s.id === m.streamId)?.name, from: m.from })) : null,
            notes: c.notes,
          }),
        ),
        streams: streams.map((s) => ({ id: s.id, name: s.name, lid: s.lid, every_weeks: s.every_weeks })),
      });
    },
    { set_up: false },
  );

  tool(
    "mark_bins_out",
    {
      description:
        "Bin night: mark the next collection's bins as out (out false undoes it). This stops the night-before reminder, the same as tapping Done on the Home card.",
      inputSchema: {
        out: z.boolean().optional(),
      },
    },
    async ({ out }, gid) => {
      const [{ streams, changes, plan }, today] = await Promise.all([binData(admin, gid), personToday(admin, userId)]);
      const state = binNightState(streams, changes, plan, today);
      if (!plan || !state.collection) return fail("Bin night isn't set up yet.");
      const patch = out === false ? { out_for: null, out_by: null } : { out_for: state.collection.date, out_by: userId };
      const { error } = await admin.from("bin_plans").update(patch).eq("id", plan.id).eq("group_id", gid);
      if (error) return fail(error.message);
      return ok({ ok: true, out: out !== false, collection: state.collection.date, bins: binNamesPhrase(state.collection.streams) });
    },
    null,
  );

  tool(
    "change_bin_collection",
    {
      description:
        "Bin night: record a one-off change, such as a public holiday. date is the day the collection was due. moved_to is the new day, or null when there is no collection that day. stream_id (from get_bin_night) limits it to one bin; leave it out to move every bin due that day. For an extra collection, pass the stream_id with date and moved_to both set to the extra day.",
      inputSchema: {
        date: ISO_DATE,
        moved_to: ISO_DATE.nullable(),
        stream_id: z.string().optional(),
        note: z.string().max(200).optional(),
      },
    },
    async ({ date, moved_to, stream_id, note }, gid) => {
      const streams = await liveRows<BinStream>(admin, "bin_streams", gid);
      if (streams.length === 0) return fail("Bin night isn't set up yet.");
      if (stream_id && !streams.some((s) => s.id === stream_id)) return fail("No such bin.");
      const row = {
        id: crypto.randomUUID(),
        group_id: gid,
        stream_id: stream_id ?? null,
        on_date: date,
        moved_to,
        note: note?.trim() || null,
        source: "manual",
        created_by: userId,
        deleted: false,
      };
      const { error } = await admin.from("bin_changes").insert(row);
      if (error) return fail(error.message);
      return ok({ ok: true, id: row.id, date, moved_to });
    },
    null,
  );

  // ── Home care ─────────────────────────────────────────────────────────────

  async function careRegion(gid: string): Promise<string | null> {
    const { data } = await admin.from("groups").select("region").eq("id", gid).maybeSingle();
    return (data as { region?: string } | null)?.region ?? null;
  }

  async function findCareJob(gid: string, id: string): Promise<CareJob | null> {
    const { data } = await admin.from("care_jobs").select("*").eq("id", id).eq("group_id", gid).eq("deleted", false);
    return ((data ?? []) as CareJob[])[0] ?? null;
  }

  tool(
    "get_care_jobs",
    {
      description:
        "Home care: the household's upkeep jobs (smoke alarms, gutters, filters...), with how often, when each is next due, and when it was last done. Due soon and overdue first. Pass room to narrow it. include_suggestions lists the built-in jobs not added yet, with their suggestion_id for add_care_job.",
      inputSchema: {
        room: z.string().optional(),
        include_paused: z.boolean().optional(),
        include_suggestions: z.boolean().optional(),
      },
    },
    async ({ room, include_paused, include_suggestions }, gid) => {
      const [rows, today, region, members] = await Promise.all([
        liveRows<CareJob>(admin, "care_jobs", gid),
        personToday(admin, userId),
        careRegion(gid),
        names(admin, gid),
      ]);
      const southern = isSouthernHemisphere(region);
      const jobs = sortByDue(liveCareJobs(rows))
        .filter((j) => j.state === "active" || (include_paused && j.state === "paused"))
        .filter((j) => !room || norm(j.room ?? "") === norm(room));
      const taken = new Set(rows.filter((j) => !j.deleted && j.suggestion_id).map((j) => j.suggestion_id));
      return ok({
        today,
        jobs: jobs.map((j) =>
          compact({
            id: j.id,
            title: j.title,
            room: j.room,
            area: j.area,
            state: j.state === "active" ? null : j.state,
            every: careEveryLabel(j, southern),
            next_due: j.next_due,
            due: careDue(j, today)?.text ?? null,
            last_done: j.last_done,
            assigned_to: who(j.assigned_to, userId, members),
            notes: j.notes,
          }),
        ),
        ...(include_suggestions
          ? {
              suggestions: careSuggestionsFor(region)
                .filter((s) => !taken.has(s.id))
                .map((s) => compact({ suggestion_id: s.id, title: s.title, room: s.room, why: s.why })),
            }
          : {}),
      });
    },
    { jobs: [] },
  );

  tool(
    "update_care_job",
    {
      description:
        "Home care: act on one job (id from get_care_jobs). action done records it done (done_on, today when left out) and works out the next due date; skip moves to the next due date without logging it; snooze pushes it back snooze_days (7 when left out); pause, resume and hide switch it off and on. Without action, changes its settings: how often (every_n with every_unit), who looks after it (assigned_to_user_id, null for nobody), reminder days before, notes.",
      inputSchema: {
        job_id: z.string(),
        action: z.enum(["done", "skip", "snooze", "pause", "resume", "hide"]).optional(),
        done_on: ISO_DATE.optional(),
        snooze_days: z.number().int().min(1).max(365).optional(),
        every_n: z.number().int().min(1).max(999).optional(),
        every_unit: z.enum(["day", "week", "month", "year"]).optional(),
        assigned_to_user_id: z.string().nullable().optional(),
        remind_days_before: z.number().int().min(0).max(90).optional(),
        notes: z.string().max(1000).nullable().optional(),
      },
    },
    async (args, gid) => {
      const [job, today] = await Promise.all([findCareJob(gid, args.job_id), personToday(admin, userId)]);
      if (!job) return fail("Care job not found");
      let patch: Partial<CareJob> = {};
      if (args.action === "done") patch = careDonePatch(job, args.done_on ?? today, userId);
      else if (args.action === "skip") patch = careSkipPatch(job, today);
      else if (args.action === "snooze") patch = careSnoozePatch(job, today, args.snooze_days ?? 7);
      else if (args.action) patch = careStatePatch(job, args.action === "resume" ? "active" : args.action === "pause" ? "paused" : "hidden", today);
      if (args.assigned_to_user_id !== undefined) {
        if (args.assigned_to_user_id && !(await names(admin, gid)).has(args.assigned_to_user_id)) return fail("That person isn't in this household.");
        patch.assigned_to = args.assigned_to_user_id;
      }
      if (args.remind_days_before !== undefined) patch.remind_days_before = args.remind_days_before;
      if (args.notes !== undefined) patch.notes = args.notes?.trim() || null;
      if (args.every_n !== undefined || args.every_unit !== undefined) {
        const schedule = { every_n: args.every_n ?? job.every_n, every_unit: (args.every_unit ?? job.every_unit) as CareUnit, season_month: null };
        Object.assign(patch, schedule);
      }
      if (Object.keys(patch).length === 0) return fail("Nothing to change.");
      const { error } = await admin.from("care_jobs").update(patch).eq("id", job.id).eq("group_id", gid);
      if (error) return fail(error.message);
      return ok(compact({ ok: true, id: job.id, title: job.title, next_due: patch.next_due ?? job.next_due, state: patch.state }));
    },
    null,
  );

  tool(
    "add_care_job",
    {
      description:
        "Home care: add an upkeep job. Pass suggestion_id (from get_care_jobs with include_suggestions) for a built-in job with its usual schedule, or a title with every_n and every_unit (\"clean the dryer vent every 6 months\"). area is one of " +
        CARE_AREAS.map((a) => a.id).join(", ") +
        ".",
      inputSchema: {
        suggestion_id: z.string().optional(),
        title: z.string().min(1).max(200).optional(),
        every_n: z.number().int().min(1).max(999).optional(),
        every_unit: z.enum(["day", "week", "month", "year"]).optional(),
        area: z.enum(CARE_AREAS.map((a) => a.id) as [CareArea, ...CareArea[]]).optional(),
        room: z.string().max(100).optional(),
      },
    },
    async ({ suggestion_id, title, every_n, every_unit, area, room }, gid) => {
      const [today, region, rows] = await Promise.all([personToday(admin, userId), careRegion(gid), liveRows<CareJob>(admin, "care_jobs", gid)]);
      let fields: ReturnType<typeof newCareJobFields>;
      if (suggestion_id) {
        const s = careSuggestionsFor(region).find((x) => x.id === suggestion_id);
        if (!s) return fail("No such suggestion.");
        if (rows.some((j) => j.suggestion_id === s.id)) return fail(`${s.title} is already in Home care.`);
        fields = careJobFromSuggestion(s, isSouthernHemisphere(region), today);
      } else {
        if (!title?.trim() || !every_unit) return fail("Pass suggestion_id, or a title with every_n and every_unit.");
        fields = newCareJobFields({ title, area, room: room ?? null, every_n: every_n ?? 1, every_unit }, today);
      }
      const row = { id: crypto.randomUUID(), group_id: gid, created_by: userId, deleted: false, ...fields };
      const { error } = await admin.from("care_jobs").insert(row);
      if (error) return fail(error.message);
      return ok({ ok: true, id: row.id, title: row.title, next_due: row.next_due });
    },
    null,
  );

  // ── Shopper watchlist ─────────────────────────────────────────────────────

  tool(
    "watch_item",
    {
      description:
        "Shopper: add something to the watchlist so Rooftap checks its price every day and says when it reaches the target. Use it for \"tell me when X drops under $Y\". Amounts in cents. status idea keeps it on the list without price checks. keep_from_user_ids keeps it (and its prices) from those members, for a present; not in the household's shared chat. Use start_scout instead when they want someone to research what to buy.",
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
    async ({ title, query, target_cents, budget_cents, need_by, notes, status, keep_from_user_ids }, gid) => {
      if (shared && keep_from_user_ids?.length) return fail("Surprises can't be planned in the household chat, where everyone reads it. Ask in a private chat.");
      const { data: members } = await admin.from("group_members").select("user_id").eq("group_id", gid);
      const keepFrom = cleanKeepFrom(keep_from_user_ids, ((members ?? []) as { user_id: string }[]).map((m) => m.user_id), userId);
      if (!keepFrom) return fail("Someone in keep_from_user_ids is not in this household");
      const wants = await liveRows<ShopperWant>(admin, "shopper_wants", gid);
      const dupe = wants.find((w) => !keptHere(w) && w.status !== "bought" && norm(w.title) === norm(title));
      if (dupe) return fail(`${dupe.title} is already on the watchlist (id ${dupe.id}); use update_watch_item.`);
      const row = {
        id: crypto.randomUUID(),
        group_id: gid,
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
      const { error } = await admin.from("shopper_wants").insert(row);
      if (error) return fail(error.message);
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
    async ({ want_id, remove, ...fields }, gid) => {
      const { data } = await admin.from("shopper_wants").select("*").eq("id", want_id).eq("group_id", gid).eq("deleted", false);
      const want = ((data ?? []) as ShopperWant[]).find((w) => !keptHere(w));
      if (!want) return fail("Watchlist item not found");
      const patch: Row = remove ? { deleted: true } : {};
      if (!remove) {
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = typeof v === "string" ? v.trim() || null : v;
        if (fields.status === "bought" && want.status !== "bought") patch.bought_at = new Date().toISOString();
        if (fields.status && fields.status !== "bought") patch.bought_at = null;
      }
      if (Object.keys(patch).length === 0) return fail("Nothing to change.");
      const { error } = await admin.from("shopper_wants").update(patch).eq("id", want.id).eq("group_id", gid);
      if (error) return fail(error.message);
      return ok({ ok: true, id: want.id, title: (patch.title as string) ?? want.title, ...(remove ? { removed: true } : {}) });
    },
    null,
  );

  // ── Checklists ────────────────────────────────────────────────────────────

  tool(
    "get_checklist_templates",
    {
      description: "Checklists: the household's templates (packing, cleaning and so on) with their items, to start a new list from with create_checklist.",
    },
    async (_args, gid) => {
      const [templates, items] = await Promise.all([
        liveRows<ChecklistTemplate>(admin, "checklist_templates", gid),
        liveRows<ChecklistTemplateItem>(admin, "checklist_template_items", gid),
      ]);
      return ok(
        templates.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.default_type ?? "plain",
          items: items.filter((i) => i.template_id === t.id).sort((a, b) => a.order - b.order).map((i) => i.label),
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
    async ({ title, template_id, items, type, scheduled_date }, gid) => {
      let checklist: Checklist;
      let rows: ReturnType<typeof buildChecklistItem>[] = [];
      if (template_id) {
        const { data } = await admin.from("checklist_templates").select("*").eq("id", template_id).eq("group_id", gid).eq("deleted", false);
        const template = ((data ?? []) as ChecklistTemplate[])[0];
        if (!template) return fail("Template not found");
        const tItems = await liveRows<ChecklistTemplateItem>(admin, "checklist_template_items", gid);
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
        checklist = buildChecklist({ groupId: gid, title, type: (type ?? "plain") as ChecklistType, scheduledDate: scheduled_date ?? null, createdBy: userId });
      }
      for (const label of items ?? []) {
        if (rows.some((r) => norm(r.label) === norm(label))) continue;
        rows.push(buildChecklistItem({ checklistId: checklist.id, groupId: gid, label, order: rows.length }));
      }
      const task = checklist.scheduled_date && enabled.has("household") ? buildLinkedTask({ checklist, createdBy: userId }) : null;
      if (task) checklist.linked_task_id = task.id;
      const { error } = await admin.from("checklists").insert(checklist);
      if (error) return fail(error.message);
      if (rows.length) {
        const { error: itemsError } = await admin.from("checklist_task_items").insert(rows);
        if (itemsError) return fail(itemsError.message);
      }
      if (task) await admin.from("household_tasks").insert({ ...task, assigned_to: userId });
      return ok({ ok: true, id: checklist.id, title: checklist.title, items: rows.length, ...(task ? { task_id: task.id } : {}), link: itemLink("checklist", checklist.id) });
    },
    null,
  );

  // ── Recipes ───────────────────────────────────────────────────────────────

  tool(
    "save_recipe",
    {
      description:
        "Recipes: save a new recipe to the household's book, from what the person typed or pasted. ingredients each have the line as written (name, e.g. \"2 cups arborio rice\"), and when you can tell them, the plain grocery item (item, e.g. \"arborio rice\"), quantity and unit. steps are the method, one per entry. Check get_recipes first so you don't save the same one twice. to_try puts it on the To try list instead of the main book: use it when the person wants to try a recipe, calls it a suggestion or an idea, or hasn't cooked it yet; they keep it from the recipe's screen once they like it.",
      inputSchema: {
        title: z.string().min(1).max(200),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(300),
              item: z.string().max(100).optional(),
              quantity: z.number().positive().optional(),
              unit: z.string().max(30).optional(),
            }),
          )
          .max(100),
        steps: z.array(z.string().min(1).max(2000)).max(100).optional(),
        servings: z.number().int().positive().max(100).optional(),
        prep_minutes: z.number().int().nonnegative().max(2880).optional(),
        cook_minutes: z.number().int().nonnegative().max(2880).optional(),
        cuisines: z.array(z.string().max(40)).max(8).optional(),
        method: z.enum(["cooking", "baking", "roasting", "other"]).optional(),
        source_url: z.string().url().optional(),
        to_try: z.boolean().optional(),
      },
    },
    async (args, gid) => {
      const existing = await liveRows<Recipe>(admin, "recipes", gid);
      const same = existing.find((r) => norm(r.title) === norm(args.title));
      if (same) return fail(`There's already a recipe called ${same.title} (id ${same.id}).`);
      const recipe = buildRecipe({
        groupId: gid,
        title: args.title,
        cuisines: args.cuisines ?? [],
        method: (args.method ?? null) as RecipeMethod | null,
        instructions: instructionsFromSteps(args.steps ?? []),
        servings: args.servings ?? null,
        prepMinutes: args.prep_minutes ?? null,
        cookMinutes: args.cook_minutes ?? null,
        source: args.source_url ?? null,
        sourceType: args.source_url ? "url" : "manual",
        toTry: args.to_try,
        createdBy: userId,
      });
      const { error } = await admin.from("recipes").insert(recipe);
      if (error) return fail(error.message);
      const ingredients = args.ingredients.map((i, position) =>
        buildRecipeIngredient({ recipeId: recipe.id, groupId: gid, name: i.name, itemName: i.item ?? null, quantity: i.quantity ?? null, unit: i.unit ?? null, position }),
      );
      if (ingredients.length) {
        const { error: ingError } = await admin.from("recipe_ingredients").insert(ingredients);
        if (ingError) return fail(ingError.message);
      }
      return ok({ ok: true, id: recipe.id, title: recipe.title, ingredients: ingredients.length, ...(recipe.to_try ? { to_try: true } : {}), link: itemLink("recipe", recipe.id) });
    },
    null,
  );

  // ── Home Setup ────────────────────────────────────────────────────────────

  const PRICE = z.number().int().nonnegative();

  tool(
    "create_setup_item",
    {
      description:
        "Home Setup: add something the household needs to buy or install for the home, in a room (\"a curtain rail for the bedroom\"). Prices in cents. private true keeps it to this person.",
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
    async (args, gid) => {
      const items = await liveRows<SetupItem>(admin, "setup_items", gid);
      const row = {
        id: crypto.randomUUID(),
        group_id: gid,
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
      const { error } = await admin.from("setup_items").insert(row);
      if (error) return fail(error.message);
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
    async ({ item_id, ...fields }, gid) => {
      const { data } = await admin.from("setup_items").select("*").eq("id", item_id).eq("group_id", gid).eq("deleted", false);
      const item = ((data ?? []) as SetupItem[]).find((i) => !(i.private && i.assigned_to !== userId));
      if (!item) return fail("Setup item not found");
      const patch: Row = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = typeof v === "string" ? v.trim() || null : v;
      if (Object.keys(patch).length === 0) return fail("Nothing to change.");
      const { error } = await admin.from("setup_items").update(patch).eq("id", item.id).eq("group_id", gid);
      if (error) return fail(error.message);
      return ok({ ok: true, id: item.id, name: (patch.name as string) ?? item.name, status: (patch.status as string) ?? item.status });
    },
    null,
  );

  // ── Documents ─────────────────────────────────────────────────────────────

  tool(
    "find_documents",
    {
      description:
        "Documents: find the household's filed papers (warranties, receipts, manuals, insurance, leases...) by words in the title, file name, tag or folder, or by type. expiring_within_days lists ones whose expiry date falls in that many days (and ones already expired in the last 30). Gives the title, type, expiry, tags and folder, and a link that opens the folder in the app; never the file itself or its details.",
      inputSchema: {
        query: z.string().optional(),
        doc_type: z
          .enum([
            "invoice",
            "receipt",
            "warranty",
            "manual",
            "contract",
            "photo",
            "other",
            "id_personal",
            "insurance",
            "lease_contract",
            "tax_financial",
            "medical",
            "vehicle",
            "appliance_manual",
          ])
          .optional(),
        expiring_within_days: z.number().int().positive().max(730).optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ query, doc_type, expiring_within_days, limit }, gid) => {
      const [docs, folderRows, today] = await Promise.all([
        liveRows<Document>(admin, "documents", gid),
        admin.from("document_folders").select("*").eq("group_id", gid),
        personToday(admin, userId),
      ]);
      const folders = (folderRows.data ?? []) as DocumentFolder[];
      const path = (id: string | null) => folderBreadcrumb(folders, id).map((f) => f.name).join(" / ");
      const needle = query?.trim().toLowerCase();
      const until = expiring_within_days ? addDaysISO(today, expiring_within_days) : null;
      const found = docs
        .filter((d) => !doc_type || d.doc_type === doc_type)
        .filter((d) => !until || (!!d.expiry_date && d.expiry_date <= until && d.expiry_date >= addDaysISO(today, -30)))
        .filter(
          (d) =>
            !needle ||
            [d.title, d.filename, path(d.folder_id), ...(d.tags ?? [])].some((s) => (s ?? "").toLowerCase().includes(needle)),
        )
        .sort((a, b) => (until ? (a.expiry_date ?? "").localeCompare(b.expiry_date ?? "") : b.created_at.localeCompare(a.created_at)));
      return ok({
        total: found.length,
        documents: found.slice(0, limit ?? 20).map((d) =>
          compact({
            id: d.id,
            title: d.title || d.filename,
            type: d.doc_type,
            expiry_date: d.expiry_date,
            expired: d.expiry_date && d.expiry_date < today ? true : null,
            tags: d.tags,
            folder: path(d.folder_id) || null,
            added: d.created_at.slice(0, 10),
            link: d.folder_id ? `/documents?folder=${d.folder_id}` : "/documents",
          }),
        ),
      });
    },
    { total: 0, documents: [] },
  );

  // ── Home Search ───────────────────────────────────────────────────────────

  tool(
    "get_home_search",
    {
      description:
        "Home Search: the places the household is looking at to rent or buy (address, rent per week in whole currency units, bedrooms, bathrooms, parking, notes, score), with their viewings (scheduled_at, status). Archived listings are left out unless include_archived is true.",
      inputSchema: {
        include_archived: z.boolean().optional(),
      },
    },
    async ({ include_archived }, gid) => {
      const [places, viewings] = await Promise.all([
        liveRows<Apartment>(admin, "apartments", gid),
        liveRows<Appointment>(admin, "appointments", gid),
      ]);
      return ok(
        places
          .filter((p) => include_archived || !p.archived)
          .map((p) =>
            compact({
              id: p.id,
              address: p.address,
              suburb: p.suburb,
              rent_per_week: p.rent_per_week,
              bedrooms: p.bedrooms,
              bathrooms: p.bathrooms,
              parking: p.parking,
              score: p.preliminary_score,
              decision: p.disposition,
              move_in_date: p.move_in_date,
              listing_url: p.listing_url,
              notes: p.notes,
              archived: p.archived || null,
              link: itemLink("listing", p.id),
              viewings: viewings
                .filter((v) => v.apartment_id === p.id)
                .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
                .map((v) => compact({ scheduled_at: v.scheduled_at, status: v.status, notes: v.notes })),
            }),
          ),
      );
    },
  );

  // ── Money insights ────────────────────────────────────────────────────────

  tool(
    "get_money_insights",
    {
      description:
        "Money insights: what the Costs page's \"Worth a look\" card says: price rises, bills ending, subscriptions to rethink (with overlaps such as two streaming services), categories running ahead or under, and the monthly goal. Each has a group (heads-up, save, reconsider, going-well), a title and a detail line. subscriptions lists every subscription with its monthly cost in cents, and whether the person decided to keep it (kept) or cancel it (cancelling) and when it comes back to decide (ask_again_at). Insights the person hid are left out.",
    },
    async (_args, gid) => {
      if (!enabled.has("costs")) return fail("Costs is switched off.");
      const data = await householdCostMonths(admin, userId, gid, (wall) => monthKeys(wall, -3, 4));
      const targets = costTargets(data.items);
      const result = costInsights({
        items: data.items.filter((i) => !i.deleted && !targets.has(i.id)),
        months: data.months,
        goalCents: data.goalCents,
        marks: data.marks,
        now: data.now,
      });
      return ok({
        insights: result.insights.map((i) => compact({ group: i.group, title: i.title, detail: i.detail, figure: i.figure?.text, cost_item_id: i.item?.id })),
        subscriptions: result.subscriptions.map((s) => compact({ name: s.name, monthly_cents: s.monthlyCents, kept: s.kept || null, cancelling: s.cancelling || null, ask_again_at: s.askAgainAt, overlap: s.overlap, was_cents: s.wasCents })),
      });
    },
    { insights: [], subscriptions: [] },
  );

  return tools;
}

