import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addBankMatch,
  bankAmountsVary,
  bankLineAmount,
  costCategoryFromUp,
  guessCadence,
  normaliseBankMatch,
  type BankTransaction,
  type CostCategory,
  type MakeCostPreview,
} from "@homeup/core";
import {
  applyBankLinks,
  bankLinkRows,
  visibleBankTransactions,
} from "@/lib/up-bank";

// The changes a person can make to bank data in Rooftap, shared by the app's
// routes and the assistant's tools so both follow the same rules: only the
// person who connected an account changes its payments, cost lines must be in
// the caller's household, and nothing is ever sent to the bank.

export interface BankCaller {
  admin: SupabaseClient;
  userId: string;
  groupId: string;
}

export type BankResult<T> = { ok: T } | { error: string; status: number };

export const NOT_OWNER =
  "Only the person who connected this account can change it.";
const NOTE_MAX = 500;
const LOOKBACK_MS = 400 * 86_400_000;

export async function bankTransactionRow(
  c: BankCaller,
  id: string,
): Promise<BankTransaction | null> {
  const { data } = await c.admin
    .from("bank_transactions")
    .select("*")
    .eq("id", id)
    .eq("group_id", c.groupId)
    .maybeSingle();
  return (data as BankTransaction | null) ?? null;
}

export async function costItemInGroup(
  c: BankCaller,
  costItemId: string,
): Promise<boolean> {
  const { data } = await c.admin
    .from("cost_items")
    .select("id")
    .eq("id", costItemId)
    .eq("group_id", c.groupId)
    .maybeSingle();
  return !!data;
}

export interface BankTransactionChange {
  hidden?: boolean;
  note?: string | null;
  /** A cost line id files it by hand; null gives it back to the link rules. */
  costItemId?: string | null;
}

/** Hide, note or file one of the caller's own payments. */
export async function changeBankTransaction(
  c: BankCaller,
  id: string,
  change: BankTransactionChange,
): Promise<BankResult<BankTransaction>> {
  const row = await bankTransactionRow(c, id);
  if (!row) return { error: "Payment not found.", status: 404 };
  if (row.user_id !== c.userId) return { error: NOT_OWNER, status: 403 };

  const patch: Record<string, unknown> = {};
  if (typeof change.hidden === "boolean") patch.hidden = change.hidden;
  if (change.note !== undefined)
    patch.note = (change.note ?? "").trim().slice(0, NOTE_MAX) || null;
  if (change.costItemId === null) {
    patch.cost_item_id = null;
    patch.link_kind = null;
  } else if (typeof change.costItemId === "string") {
    if (!(await costItemInGroup(c, change.costItemId)))
      return { error: "That cost line isn't in your household.", status: 400 };
    patch.cost_item_id = change.costItemId;
    patch.link_kind = "manual";
  }
  if (!Object.keys(patch).length)
    return { error: "Nothing to change.", status: 400 };

  const { data: saved, error } = await c.admin
    .from("bank_transactions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !saved)
    return { error: error?.message ?? "Couldn't save.", status: 500 };

  // A payment given back to the rules gets whatever line they pick now; a
  // hidden or relinked payment can change a keep-in-step line's amount.
  if ("hidden" in patch || "cost_item_id" in patch) {
    const at = Date.parse((saved as BankTransaction).occurred_at);
    await applyBankLinks(c.admin, c.groupId, {
      userId: c.userId,
      since: new Date(at - 1000).toISOString(),
    });
  }
  return {
    ok: (await bankTransactionRow(c, id)) ?? (saved as BankTransaction),
  };
}

function refuseCost(
  t: BankTransaction | null,
  userId: string,
): { error: string; status: number } | null {
  if (!t) return { error: "Payment not found.", status: 404 };
  if (t.user_id !== userId) return { error: NOT_OWNER, status: 403 };
  if (t.amount_cents >= 0 || t.is_transfer)
    return { error: "Only money going out can become a cost.", status: 400 };
  return null;
}

async function previewFor(
  c: BankCaller,
  t: BankTransaction,
): Promise<MakeCostPreview> {
  const rows = await visibleBankTransactions(c.admin, {
    userId: c.userId,
    groupId: c.groupId,
    from: new Date(Date.now() - LOOKBACK_MS).toISOString(),
    limit: 5000,
  });
  const same = Array.from(
    new Map(
      rows
        .filter((r) => r.description === t.description && r.amount_cents < 0)
        .map((r) => [r.external_id, r]),
    ).values(),
  );
  // Newest first, this payment leading: a bill that changes becomes an
  // estimate at the average of the latest three.
  const amounts = [
    t.amount_cents,
    ...same
      .filter(
        (r) =>
          r.external_id !== t.external_id && r.occurred_at <= t.occurred_at,
      )
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .map((r) => r.amount_cents),
  ];
  const estimate = bankAmountsVary(amounts);
  return {
    name: t.description,
    amountCents: bankLineAmount(amounts, estimate) ?? Math.abs(t.amount_cents),
    category: costCategoryFromUp(t.category),
    cadence: guessCadence(same.map((r) => r.occurred_at)),
    seen: same.length,
    estimate,
  };
}

/** What "Make it a cost" would create from this payment. */
export async function bankCostPreview(
  c: BankCaller,
  id: string,
): Promise<BankResult<MakeCostPreview>> {
  const t = await bankTransactionRow(c, id);
  const no = refuseCost(t, c.userId);
  if (no) return no;
  return { ok: await previewFor(c, t!) };
}

/**
 * Creates a cost line from one of the caller's payments and files the payment
 * under it. With linkPayee, the payee's other payments follow it as well.
 */
export async function makeCostFromPayment(
  c: BankCaller,
  id: string,
  input: { name?: string; linkPayee?: boolean; category?: CostCategory },
): Promise<
  BankResult<{ costItemId: string; name: string; transaction: BankTransaction }>
> {
  const t = await bankTransactionRow(c, id);
  const no = refuseCost(t, c.userId);
  if (no) return no;
  const plan = await previewFor(c, t!);
  const name = input.name?.trim().slice(0, 200) || plan.name;

  const { data: item, error } = await c.admin
    .from("cost_items")
    .insert({
      group_id: c.groupId,
      name,
      category: input.category ?? plan.category,
      amount: plan.amountCents,
      cadence: plan.cadence,
      is_estimate: plan.estimate,
      start_date: t!.occurred_at.slice(0, 10),
      provider: t!.description,
      created_by: c.userId,
    })
    .select("id")
    .single();
  if (error || !item)
    return {
      error: `The cost couldn't be saved: ${error?.message}`,
      status: 500,
    };

  await c.admin
    .from("bank_transactions")
    .update({ cost_item_id: item.id, link_kind: "manual" })
    .eq("id", t!.id);
  if (input.linkPayee) {
    const linked = await setBankLinkRule(
      c,
      item.id as string,
      t!.description,
      false,
    );
    if ("error" in linked) return linked;
  }
  return {
    ok: {
      costItemId: item.id as string,
      name,
      transaction: (await bankTransactionRow(c, t!.id)) ?? t!,
    },
  };
}

/**
 * Files a payment under a Costs category. A payment on its shop's own line
 * (one the bank made for that payee) moves with the whole shop: the line
 * takes the new category, as editing the line in the app does. Any other
 * payment gets a line of its own in that category, so a shared line (say
 * Groceries) keeps its other payments where they are.
 */
export async function filePaymentInCategory(
  c: BankCaller,
  id: string,
  category: CostCategory,
): Promise<
  BankResult<{ costItemId: string; name: string; movedLine: boolean }>
> {
  const t = await bankTransactionRow(c, id);
  const no = refuseCost(t, c.userId);
  if (no) return no;
  if (t!.cost_item_id) {
    const { data: line } = await c.admin
      .from("cost_items")
      .select("id, name, category, bank_source")
      .eq("id", t!.cost_item_id)
      .eq("group_id", c.groupId)
      .maybeSingle();
    const l = line as {
      id: string;
      name: string;
      category: string;
      bank_source?: string | null;
    } | null;
    if (l?.category === category)
      return { ok: { costItemId: l.id, name: l.name, movedLine: false } };
    if (l?.bank_source) {
      const { error } = await c.admin
        .from("cost_items")
        .update({ category })
        .eq("id", l.id)
        .eq("group_id", c.groupId);
      if (error) return { error: error.message, status: 500 };
      return { ok: { costItemId: l.id, name: l.name, movedLine: true } };
    }
  }
  const made = await makeCostFromPayment(c, id, { category });
  if ("error" in made) return made;
  return {
    ok: {
      costItemId: made.ok.costItemId,
      name: made.ok.name,
      movedLine: false,
    },
  };
}

/**
 * Links a payee (words in the description) or an Up #tag to a cost line, so
 * its payments file there from now on, and re-applies every rule in the home.
 */
export async function setBankLinkRule(
  c: BankCaller,
  costItemId: string,
  rawMatch: string,
  keepAmount: boolean,
): Promise<BankResult<{ match: string }>> {
  if (!(await costItemInGroup(c, costItemId)))
    return { error: "That cost line isn't in your household.", status: 404 };
  const match = normaliseBankMatch(rawMatch);
  if (!match || match.length > 200)
    return { error: "Pick a payee or an Up tag.", status: 400 };
  const { error } = await c.admin.from("bank_links").upsert(
    {
      cost_item_id: costItemId,
      group_id: c.groupId,
      match,
      keep_amount: keepAmount,
      created_by: c.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cost_item_id" },
  );
  if (error) return { error: error.message, status: 500 };
  await applyBankLinks(c.admin, c.groupId);
  return { ok: { match } };
}

export async function removeBankLinkRule(
  c: BankCaller,
  costItemId: string,
): Promise<BankResult<true>> {
  if (!(await costItemInGroup(c, costItemId)))
    return { error: "That cost line isn't in your household.", status: 404 };
  const { error } = await c.admin
    .from("bank_links")
    .delete()
    .eq("cost_item_id", costItemId)
    .eq("group_id", c.groupId);
  if (error) return { error: error.message, status: 500 };
  await applyBankLinks(c.admin, c.groupId);
  return { ok: true };
}

/** The longest a rule's match may be (bank_links.match). */
const MATCH_MAX = 1000;

/**
 * Folds one cost line into another: its payees join the other line's rule,
 * its payments move there, and the line goes. For a line the bank made that
 * belongs with one made by hand, such as a water bill.
 */
export async function mergeCostLine(
  c: BankCaller,
  costItemId: string,
  intoId: string,
): Promise<BankResult<{ into: string }>> {
  if (costItemId === intoId)
    return { error: "Pick another line to merge into.", status: 400 };
  if (
    !(await costItemInGroup(c, costItemId)) ||
    !(await costItemInGroup(c, intoId))
  )
    return { error: "That cost line isn't in your household.", status: 404 };

  const rules = await bankLinkRows(c.admin, c.groupId);
  const from = rules.find((r) => r.cost_item_id === costItemId);
  const into = rules.find((r) => r.cost_item_id === intoId);
  if (from) {
    const match = into ? addBankMatch(into.match, from.match) : from.match;
    if (match && match.length > MATCH_MAX)
      return {
        error: "That line already matches too many payees.",
        status: 400,
      };
    if (match) {
      const { error } = await c.admin.from("bank_links").upsert(
        {
          cost_item_id: intoId,
          group_id: c.groupId,
          match,
          keep_amount: into?.keep_amount ?? false,
          // Joint only while both sides were; a hand-made rule fits every account.
          ...(from.joint_only !== undefined
            ? {
                joint_only: into
                  ? !!into.joint_only && !!from.joint_only
                  : !!from.joint_only,
              }
            : {}),
          created_by: into?.created_by ?? c.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "cost_item_id" },
      );
      if (error) return { error: error.message, status: 500 };
    }
    await c.admin
      .from("bank_links")
      .delete()
      .eq("cost_item_id", costItemId)
      .eq("group_id", c.groupId);
  }

  await c.admin
    .from("bank_transactions")
    .update({ cost_item_id: intoId })
    .eq("group_id", c.groupId)
    .eq("cost_item_id", costItemId);
  const { error } = await c.admin
    .from("cost_items")
    .update({ deleted: true })
    .eq("id", costItemId)
    .eq("group_id", c.groupId);
  if (error) return { error: error.message, status: 500 };
  await applyBankLinks(c.admin, c.groupId);
  return { ok: { into: intoId } };
}
