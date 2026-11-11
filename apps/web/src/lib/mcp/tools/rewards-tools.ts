import { z } from "zod";
import {
  addDaysISO,
  brandKey,
  buildRewardPerk,
  cardExpiryCaption,
  cardsForStore,
  cardTitle,
  householdCurrency,
  loyaltyNumberTail,
  perksEndingSoon,
  perkValueLabel,
  type LoyaltyCard,
  type RewardPartner,
  type RewardPerk,
  type RewardScheme,
} from "@homeup/core";
import {
  compact,
  fail,
  ISO_DATE,
  names,
  ok,
  personToday,
  toolRegistrar,
  who,
  type HouseholdTool,
  type HouseholdToolContext,
  type Row,
} from "../tool-kit";

// Rewards: loyalty cards, schemes and perks. Another member's "Just me"
// card never shows (tool-data.ts), and a card number shows only its tail.

export function rewardsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId } = ctx;
  const { tools, tool, db, groupId } = toolRegistrar(ctx);

  async function rewardsData() {
    const [schemes, partners, perks, cards] = await Promise.all([
      db.rows<RewardScheme>("reward_schemes"),
      db.rows<RewardPartner>("reward_partners"),
      db.rows<RewardPerk>("reward_perks"),
      db.rows<LoyaltyCard>("loyalty_cards"),
    ]);
    return { schemes, partners, perks, cards };
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

  async function moneySymbol(): Promise<string> {
    const currency = householdCurrency(await db.group<{ region?: string | null; currency?: string | null }>("region, currency"));
    // currency.ts is client-only, so the symbol comes straight from Intl.
    try {
      return (
        new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency
      );
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
        'Rewards: loyalty cards, memberships and the perks they get the household. Pass store (a shop\'s name) for which cards and schemes work there, best perk first: use it for "which card do I use at Bunnings?". Without store: the household\'s cards, and perks ending in the next 30 days. Cards show only the last digits of the number (the app shows the barcode). Another member\'s "Just me" cards are never included.',
      inputSchema: {
        store: z.string().optional(),
      },
    },
    async ({ store }) => {
      const [data, today, members, symbol] = await Promise.all([
        rewardsData(),
        personToday(admin, userId),
        names(admin, groupId),
        moneySymbol(),
      ]);
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
        schemes: data.schemes.map((s) =>
          compact({ id: s.id, name: s.name, kind: s.kind, stores: data.partners.filter((p) => p.scheme_id === s.id).length }),
        ),
        perks_ending_soon: perksEndingSoon(
          data.perks.filter((p) => !p.deleted),
          today,
        ).map((p) => ({
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
        'Rewards: save a perk a scheme gives ("Flybuys: 10% off at Kmart until Sunday"). scheme is the scheme\'s name or id from get_rewards. store limits it to one partner store; leave it out for every store. kind is percent (value 10 for 10%), amount (value in whole currency units), points (value is the multiplier), freebie or other. valid_until is the last day it applies.',
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
    async ({ scheme, title, kind, value, store, conditions, valid_until }) => {
      const data = await rewardsData();
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
        groupId: groupId,
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
      await db.insert("reward_perks", row);
      return ok({ ok: true, id: row.id, scheme: s.name, title: row.title });
    },
    null,
  );

  return tools;
}
