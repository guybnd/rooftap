import { z } from "zod";
import { listCostItems, CATEGORY_META, summariseAccounts, summariseSpending, bankRowJoint, costCategoryFromUp } from "@homeup/core";
import { bankSharing, visibleBankAccounts, visibleBankTransactions } from "@/lib/up-bank";
import {
  changeBankTransaction,
  filePaymentInCategory,
  makeCostFromPayment,
  mergeCostLine,
  removeBankLinkRule,
  setBankLinkRule,
} from "@/lib/bank-actions";
import { fail, ok, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";
import { CATEGORY_CHOICES, costCategoryFrom } from "./costs-tools";

// Up Bank connector: the caller's Up transactions, and those of household
// members who share theirs, and the same actions as the Money view. Bank
// rows are read and changed through lib/up-bank.ts and lib/bank-actions.ts,
// which apply the sharing rule (only the person who connected an account
// changes its payments, and nothing goes to the bank).

export function bankTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId } = ctx;
  const { tools, tool, groupId } = toolRegistrar(ctx);

  const bankResult = (result: { ok: unknown } | { error: string }, body: (ok: never) => unknown) =>
    "error" in result ? fail(result.error) : ok(body(result.ok as never));

  tool(
    "get_bank_spending",
    {
      description:
        "Up Bank: account balances and spending from the bank data this person may see (their own, plus household members who share theirs). Current balances per account, totals and the matching transactions, newest first. spent_cents, by_category (Up's categories) and by_cost_category (the Costs categories) count every payment in the range, however many there are; transactions lists only the newest ones (limit), so add up the totals, never the list. accounts narrows it to joint or personal accounts; unfiled lists only payments no cost line holds. Each transaction has an id for update_bank_payment and make_cost_from_payment, its Costs category (cost_category), and cost_item_id and cost_line when it is filed under a cost line. Amounts in cents; money out is negative. Transfers between their own accounts and payments hidden from spending are left out. Defaults to the last 30 days.",
      inputSchema: {
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("First day, YYYY-MM-DD."),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Last day, YYYY-MM-DD, included."),
        search: z.string().max(100).optional().describe("Words in the description, e.g. a store name."),
        category: z.string().max(60).optional().describe("Up category id, e.g. takeaway, groceries, fuel."),
        accounts: z
          .enum(["all", "joint", "personal"])
          .optional()
          .describe("Joint accounts only, personal accounts only, or all (the default)."),
        unfiled: z.boolean().optional().describe("Only payments not filed under any cost line, to reconcile them."),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ from, to, search, category, accounts, unfiled, limit }) => {
      const end = to ? new Date(`${to}T00:00:00Z`).getTime() + 86_400_000 : Date.now();
      const start = from ? new Date(`${from}T00:00:00Z`).getTime() : end - 30 * 86_400_000;
      if (!(end > start) || end - start > 400 * 86_400_000) return fail("Pick a range of up to about a year.");
      let rows = await visibleBankTransactions(admin, {
        userId,
        groupId,
        from: new Date(start).toISOString(),
        to: new Date(end).toISOString(),
        limit: 5000,
      });
      const words = search?.trim().toLowerCase();
      if (words) rows = rows.filter((r) => `${r.description} ${r.message ?? ""} ${(r.tags ?? []).join(" ")}`.toLowerCase().includes(words));
      if (category) rows = rows.filter((r) => r.category === category || r.parent_category === category);
      if (accounts && accounts !== "all") {
        const sharing = await bankSharing(admin, userId, groupId);
        rows = rows.filter((r) => bankRowJoint(r, sharing) === (accounts === "joint"));
      }
      if (unfiled) rows = rows.filter((r) => !r.cost_item_id);
      const summary = summariseSpending(rows, from ?? new Date(start).toISOString().slice(0, 10), { recent: 0 });
      // A joint payment arrives once per partner who shares it; keep the
      // caller's own copy, the one they can change.
      const byPayment = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (r.is_transfer || r.hidden) continue;
        const had = byPayment.get(r.external_id);
        if (!had || (had.user_id !== userId && r.user_id === userId)) byPayment.set(r.external_id, r);
      }
      const listed = Array.from(byPayment.values())
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, limit ?? 30);
      // Totals in the Costs categories: the cost line's when it is filed, else from Up's.
      const lines = new Map((await listCostItems(admin, groupId)).map((i) => [i.id, i]));
      const lineCategory = new Map([...lines].map(([id, i]) => [id, i.category]));
      const costLabel = (t: (typeof rows)[number]) => {
        const c = (t.cost_item_id && lineCategory.get(t.cost_item_id)) || costCategoryFromUp(t.category ?? t.parent_category);
        return CATEGORY_META[c as keyof typeof CATEGORY_META]?.label ?? c;
      };
      const byCost = new Map<string, number>();
      let payments = 0;
      for (const t of byPayment.values()) {
        if (t.amount_cents >= 0) continue;
        payments++;
        const label = costLabel(t);
        byCost.set(label, (byCost.get(label) ?? 0) + -t.amount_cents);
      }
      // Balances arrive with servers that have bank_accounts; older ones have none to show.
      const balances = summariseAccounts(await visibleBankAccounts(admin, userId, groupId).catch(() => []));
      return ok({
        accounts: balances.accounts.map((a) => ({
          name: a.name,
          type: a.type === "SAVER" ? "saver" : "everyday",
          joint: a.joint,
          balance_cents: a.balanceCents,
        })),
        from: new Date(start).toISOString().slice(0, 10),
        to: new Date(end - 1).toISOString().slice(0, 10),
        spent_cents: summary.spentCents,
        received_cents: summary.receivedCents,
        payments_out: payments,
        by_category: summary.categories.map((c) => ({
          category: c.id,
          label: c.label,
          cents: c.cents,
        })),
        by_cost_category: [...byCost].sort((a, b) => b[1] - a[1]).map(([label, cents]) => ({ label, cents })),
        listed: `${listed.length} newest of ${byPayment.size}`,
        transactions: listed.map((t) => ({
          id: t.id,
          date: t.occurred_at.slice(0, 10),
          description: t.description,
          amount_cents: t.amount_cents,
          category: t.category ?? t.parent_category,
          tags: t.tags?.length ? t.tags : undefined,
          note: t.note || undefined,
          cost_item_id: t.cost_item_id ?? null,
          ...(t.cost_item_id && lines.get(t.cost_item_id) ? { cost_line: lines.get(t.cost_item_id)!.name } : {}),
          cost_category: costLabel(t),
          pending: t.status === "HELD",
          mine: t.user_id === userId,
        })),
      });
    },
    null,
  );

  tool(
    "update_bank_payment",
    {
      description:
        "Up Bank: change one of this person's own bank payments (ids from get_bank_spending). To put it in another Costs category (\"file it under Going out\"), pass category: no line id is needed. A payment on its shop's own line moves the whole shop to that category; any other payment gets a line of its own there. Or file it under a cost line by hand (cost_item_id, from get_budget_summary's cost_lines), give it back to the link rules (cost_item_id: null), hide it from spending or count it again (hidden), or set a note (note; null clears it). To file every payment from this payee under a line, also call set_bank_link_rule. Payments a household member shares can't be changed.",
      inputSchema: {
        payment_id: z.string(),
        category: z.string().max(40).optional().describe(`A Costs category, by name or id: ${CATEGORY_CHOICES}.`),
        cost_item_id: z.string().nullable().optional(),
        hidden: z.boolean().optional(),
        note: z.string().max(500).nullable().optional(),
      },
    },
    async ({ payment_id, category, cost_item_id, hidden, note }) => {
      let filed: {
        cost_item_id: string;
        line: string;
        category: string;
        moved_whole_shop: boolean;
      } | null = null;
      if (category !== undefined) {
        const c = costCategoryFrom(category);
        if (!c || c === "income") return fail(`No Costs category called ${category}. Pick one of: ${CATEGORY_CHOICES}.`);
        const done = await filePaymentInCategory({ admin, userId, groupId }, payment_id, c);
        if ("error" in done) return fail(done.error);
        filed = {
          cost_item_id: done.ok.costItemId,
          line: done.ok.name,
          category: CATEGORY_META[c].label,
          moved_whole_shop: done.ok.movedLine,
        };
        if (cost_item_id === undefined && hidden === undefined && note === undefined) {
          return ok({ ok: true, id: payment_id, ...filed });
        }
      }
      const result = await changeBankTransaction({ admin, userId, groupId }, payment_id, { costItemId: cost_item_id, hidden, note });
      return bankResult(
        result,
        (t: { id: string; description: string; cost_item_id: string | null; hidden: boolean; note: string | null }) => ({
          ok: true,
          id: t.id,
          description: t.description,
          cost_item_id: t.cost_item_id,
          hidden: t.hidden,
          note: t.note,
          ...(filed ? { filed } : {}),
        }),
      );
    },
    null,
  );

  tool(
    "make_cost_from_payment",
    {
      description:
        "Up Bank: create a household cost line from one of this person's own payments (id from get_bank_spending) and file the payment under it. Rooftap takes the amount, a category from the bank's (or category, when given), and how often from the payee's past payments. Pass name to call it something else (e.g. Rent). link_future_payments files the payee's other payments under the new line too. Use update_bank_payment instead when a matching cost line already exists.",
      inputSchema: {
        payment_id: z.string(),
        name: z.string().min(1).max(200).optional(),
        category: z.string().max(40).optional().describe(`A Costs category, by name or id: ${CATEGORY_CHOICES}.`),
        link_future_payments: z.boolean().optional(),
      },
    },
    async ({ payment_id, name, category, link_future_payments }) => {
      const c = category === undefined ? undefined : costCategoryFrom(category);
      if (c === null || c === "income") return fail(`No Costs category called ${category}. Pick one of: ${CATEGORY_CHOICES}.`);
      const result = await makeCostFromPayment({ admin, userId, groupId }, payment_id, {
        name,
        linkPayee: link_future_payments === true,
        category: c,
      });
      return bankResult(result, (ok: { costItemId: string; name: string }) => ({
        ok: true,
        cost_item_id: ok.costItemId,
        name: ok.name,
      }));
    },
    null,
  );

  tool(
    "set_bank_link_rule",
    {
      description:
        "Up Bank: file bank payments under a cost line automatically. match is words from the payee's description (e.g. the landlord's name) or an Up tag written as #tag. Past and future payments that match move to the line. keep_amount keeps the line's amount in step with the latest payment. match: null removes the cost line's rule. One rule per cost line; a new one replaces it.",
      inputSchema: {
        cost_item_id: z.string(),
        match: z.string().max(200).nullable(),
        keep_amount: z.boolean().optional(),
      },
    },
    async ({ cost_item_id, match, keep_amount }) => {
      const caller = { admin, userId, groupId };
      if (match === null) {
        const removed = await removeBankLinkRule(caller, cost_item_id);
        return bankResult(removed, () => ({
          ok: true,
          cost_item_id,
          match: null,
        }));
      }
      const result = await setBankLinkRule(caller, cost_item_id, match, keep_amount === true);
      return bankResult(result, (ok: { match: string }) => ({
        ok: true,
        cost_item_id,
        match: ok.match,
      }));
    },
    null,
  );

  tool(
    "merge_cost_lines",
    {
      description:
        "Up Bank: fold one cost line into another, for a line the bank made that duplicates one the household made by hand (say a water bill). The first line's payees join the second line's rule, its payments move over, and the first line is deleted. Ids from get_budget_summary.",
      inputSchema: {
        cost_item_id: z.string(),
        into_cost_item_id: z.string(),
      },
    },
    async ({ cost_item_id, into_cost_item_id }) => {
      const result = await mergeCostLine({ admin, userId, groupId }, cost_item_id, into_cost_item_id);
      return bankResult(result, () => ({
        ok: true,
        merged: cost_item_id,
        into: into_cost_item_id,
      }));
    },
    null,
  );

  return tools;
}
