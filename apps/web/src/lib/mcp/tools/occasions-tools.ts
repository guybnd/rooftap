import { z } from "zod";
import {
  buildGiftIdea,
  buildOccasion,
  buildWishlistItem,
  daysToOccasion,
  defaultHiddenFrom,
  ideasForOccasion,
  nextOccasionDay,
  sortOccasions,
  suggestedOccasionTitle,
  takenBy,
  wishlistOccasion,
  type Occasion,
  type GiftIdea,
  type WishlistItem,
} from "@homeup/core";
import { memberNames } from "@/lib/member-names";
import { personTimeZone, todayIn } from "@/lib/meal-plan-server";
import { basic, fail, ok, toolRegistrar, type Admin, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";
import { type ToolData } from "../tool-data";

// Occasions (gifts): "add these to Tegan's birthday list". Occasions and
// gift ideas kept from this person never show (tool-data.ts). In the
// household's shared chat everyone reads the reply, so nothing kept from
// anyone is shown, and gift ideas can't be added there at all.

/** The household's occasions this person may see, their today and the member ids. */
export async function occasionsContext(admin: Admin, db: ToolData) {
  const [timeZone, memberIds, occasions] = await Promise.all([
    personTimeZone(admin, db.viewer.userId),
    db.memberIds(),
    db.rows<Occasion>("occasions"),
  ]);
  return { today: todayIn(timeZone), memberIds, occasions };
}

export function occasionsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId, shared = false, occasionDatesOnly = false } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  const priceCents = (price: number | undefined) => (price == null ? null : Math.round(price * 100));
  const giftItem = z.object({
    title: z.string().min(1).max(200),
    price: z.number().nonnegative().optional().describe("Whole currency units."),
    url: z.string().max(2000).optional(),
    notes: z.string().max(1000).optional(),
  });

  tool(
    "get_occasions",
    {
      description: occasionDatesOnly
        ? "Occasions: the household's birthdays, anniversaries, holidays and other days, soonest first, with next_date, days_to and who it is for. Dates only: gift plans are not available here."
        : "Occasions: the household's birthdays, anniversaries and other days, soonest first, with next_date, days_to, who it is for (person_user_id for a member, person for a name), the gift budget and the gift ideas so far (status idea, watching, bought or booked; prices in cents; kept_from names the members an idea is kept from). wishlists lists each member's own wishlist; taken says someone already plans to give that thing. Never tell a member about ideas kept from them.",
    },
    async () => {
      const { today, occasions } = await occasionsContext(admin, db);
      if (occasionDatesOnly) {
        // An allowlist, and the gift tables stay unread, so a new field can't leak here.
        const memberName = await memberNames(admin, groupId);
        return ok({
          today,
          occasions: sortOccasions(occasions, today).map((o) => ({
            title: o.title,
            kind: o.kind,
            next_date: nextOccasionDay(o, today),
            days_to: daysToOccasion(o, today),
            ...(o.person_id ? { person: memberName.get(o.person_id) ?? "Someone" } : o.person_name ? { person: o.person_name } : {}),
          })),
        });
      }
      const [names, ideas, wishes] = await Promise.all([
        memberNames(admin, groupId),
        db.rows<GiftIdea>("gift_ideas"),
        db.rows<WishlistItem>("wishlist_items"),
      ]);
      const nameOf = (id: string) => names.get(id) ?? "Someone";
      const ideaOut = (i: GiftIdea) => ({
        ...basic(i, ["id", "title", "status", "price_cents", "url", "notes"] as const),
        ...(i.for_user_id ? { for: nameOf(i.for_user_id) } : i.for_name ? { for: i.for_name } : {}),
        ...(i.hidden_from.length ? { kept_from: i.hidden_from.map(nameOf) } : {}),
      });
      const loose = ideas.filter((i) => !i.occasion_id || !occasions.some((o) => o.id === i.occasion_id));
      const owners = [...new Set(wishes.map((w) => w.user_id))];
      return ok({
        today,
        occasions: sortOccasions(occasions, today).map((o) => ({
          id: o.id,
          title: o.title,
          kind: o.kind,
          date: o.date,
          repeats: o.repeats,
          next_date: nextOccasionDay(o, today),
          days_to: daysToOccasion(o, today),
          ...(o.person_id ? { person_user_id: o.person_id, person: nameOf(o.person_id) } : o.person_name ? { person: o.person_name } : {}),
          ...(o.budget_cents != null ? { budget_cents: o.budget_cents } : {}),
          ...(o.notes ? { notes: o.notes } : {}),
          ...(o.hidden_from.length ? { kept_from: o.hidden_from.map(nameOf) } : {}),
          ideas: ideasForOccasion(ideas, o.id).map(ideaOut),
        })),
        ...(loose.length ? { other_ideas: loose.map(ideaOut) } : {}),
        wishlists: owners.map((owner) => ({
          user_id: owner,
          name: nameOf(owner),
          items: wishes
            .filter((w) => w.user_id === owner)
            .map((w) => ({
              ...basic(w, ["id", "title", "price_cents", "url", "notes"] as const),
              // Never to the owner, and never where the owner may read it.
              ...(!shared && owner !== userId && takenBy(w, ideas) ? { taken: true } : {}),
            })),
        })),
      });
    },
    null,
  );

  tool(
    "add_occasion",
    {
      description:
        "Occasions: add a birthday, anniversary or other day. person_user_id for a household member, or person_name for someone outside it (Mum). date is YYYY-MM-DD; for a birthday or anniversary with an unknown year use any year, it repeats every year. budget in whole currency units. keep_from_user_ids keeps it from those members, for a surprise party; not in the household's shared chat. Ask for the date rather than guessing it.",
      inputSchema: {
        kind: z.enum(["birthday", "anniversary", "holiday", "other"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string().max(120).optional().describe('Defaults to "Tegan\'s birthday" style.'),
        person_user_id: z.string().optional(),
        person_name: z.string().max(80).optional(),
        repeats: z.boolean().optional().describe("Every year; true by default."),
        budget: z.number().nonnegative().optional(),
        notes: z.string().max(1000).optional(),
        keep_from_user_ids: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ kind, date, title, person_user_id, person_name, repeats, budget, notes, keep_from_user_ids }) => {
      if (shared && keep_from_user_ids?.length) {
        return fail("Surprises can't be planned in the household chat, where everyone reads it. Ask in a private chat.");
      }
      const { memberIds, occasions } = await occasionsContext(admin, db);
      if (person_user_id && !memberIds.includes(person_user_id)) return fail("That person is not in this household");
      const keepFrom = [...new Set(keep_from_user_ids ?? [])].filter((id) => id !== userId);
      if (keepFrom.some((id) => !memberIds.includes(id))) return fail("Someone in keep_from_user_ids is not in this household");
      const names = await memberNames(admin, groupId);
      const who = person_user_id ? (names.get(person_user_id) ?? null) : person_name?.trim() || null;
      if (kind === "birthday" && person_user_id) {
        const existing = occasions.find((o) => o.kind === "birthday" && o.person_id === person_user_id);
        if (existing) return fail(`${who ?? "They"} already have a birthday in Occasions (id ${existing.id}, ${existing.date})`);
      }
      const row = buildOccasion({
        id: crypto.randomUUID(),
        groupId,
        title: title?.trim() || suggestedOccasionTitle(kind, who) || kind[0].toUpperCase() + kind.slice(1),
        kind,
        date,
        repeats,
        personId: person_user_id ?? null,
        personName: person_name ?? null,
        budgetCents: priceCents(budget),
        notes: notes ?? null,
        hiddenFrom: keepFrom,
        createdBy: userId,
      });
      await db.insert("occasions", row);
      return ok({
        ok: true,
        id: row.id,
        title: row.title,
        date: row.date,
        ...(keepFrom.length ? { kept_from: keepFrom.map((id) => names.get(id) ?? "Someone") } : {}),
      });
    },
    null,
  );

  tool(
    "add_gift_ideas",
    {
      description:
        "Occasions: add one or more gift ideas for someone, say a list the person gives you for a member's birthday. Pass occasion_id (from get_occasions), or for_user_id for a member and the ideas go under their next birthday, or for_name for someone outside the household. An idea for another member is kept from them by default (they never see it, its watch or its budget line); keep_from_user_ids replaces who it is kept from ([] for nobody). Prices in whole currency units. To add to the person's own wishlist use add_wishlist_items instead; nobody can change another member's wishlist. Not available in the household's shared chat.",
      inputSchema: {
        ideas: z.array(giftItem).min(1).max(30),
        occasion_id: z.string().optional(),
        for_user_id: z.string().optional(),
        for_name: z.string().max(80).optional(),
        keep_from_user_ids: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ ideas, occasion_id, for_user_id, for_name, keep_from_user_ids }) => {
      // The tool isn't offered there; this guards a call that gets through anyway.
      if (shared) return fail("Gift ideas can't be added in the household chat, where everyone reads it. Ask in a private chat.");
      const { today, memberIds, occasions } = await occasionsContext(admin, db);
      if (for_user_id && !memberIds.includes(for_user_id)) return fail("That person is not in this household");
      const names = await memberNames(admin, groupId);
      let occasion: Occasion | null = null;
      if (occasion_id) {
        occasion = occasions.find((o) => o.id === occasion_id) ?? null;
        if (!occasion) return fail("Occasion not found");
      } else if (for_user_id) {
        occasion = wishlistOccasion(for_user_id, occasions, today);
        if (!occasion) {
          return fail(
            `There is no birthday for ${names.get(for_user_id) ?? "them"} in Occasions yet. Ask for the date and add it with add_occasion, then add the ideas.`,
          );
        }
      } else if (for_name?.trim()) {
        const wanted = for_name.trim().toLowerCase();
        occasion =
          sortOccasions(
            occasions.filter((o) => o.person_name?.trim().toLowerCase() === wanted),
            today,
          )[0] ?? null;
        if (!occasion) return fail(`No occasion for ${for_name.trim()} yet. Add one with add_occasion first.`);
      } else {
        return fail("Say who the ideas are for: occasion_id, for_user_id or for_name");
      }
      const forUserId = for_user_id ?? occasion.person_id;
      const forName = forUserId ? null : for_name?.trim() || occasion.person_name;
      const chosen = keep_from_user_ids ?? defaultHiddenFrom(forUserId, userId, memberIds);
      if (chosen.some((id) => !memberIds.includes(id))) return fail("Someone in keep_from_user_ids is not in this household");
      // An idea for a surprise stays kept from whoever the occasion is kept from, and never from the person adding it.
      const hiddenFrom = [...new Set([...chosen, ...occasion.hidden_from])].filter((id) => id !== userId);
      const rows = ideas.map((idea) =>
        buildGiftIdea({
          id: crypto.randomUUID(),
          groupId,
          title: idea.title,
          occasionId: occasion.id,
          forUserId,
          forName,
          priceCents: priceCents(idea.price),
          url: idea.url ?? null,
          notes: idea.notes ?? null,
          hiddenFrom,
          createdBy: userId,
        }),
      );
      await db.insert("gift_ideas", rows);
      return ok({
        ok: true,
        occasion: occasion.title,
        added: rows.map((r) => r.title),
        kept_from: hiddenFrom.map((id) => names.get(id) ?? "Someone"),
      });
    },
    null,
  );

  tool(
    "add_wishlist_items",
    {
      description:
        "Occasions: add things to the person's own wishlist, which everyone in the household can see so they know what to give. Prices in whole currency units. Only the person's own list; for gift ideas for someone else use add_gift_ideas.",
      inputSchema: {
        items: z.array(giftItem).min(1).max(30),
      },
    },
    async ({ items }) => {
      const rows = items.map((item) =>
        buildWishlistItem({
          id: crypto.randomUUID(),
          groupId,
          userId,
          title: item.title,
          url: item.url ?? null,
          priceCents: priceCents(item.price),
          notes: item.notes ?? null,
        }),
      );
      await db.insert("wishlist_items", rows);
      return ok({ ok: true, added: rows.map((r) => r.title) });
    },
    null,
  );

  return tools;
}
