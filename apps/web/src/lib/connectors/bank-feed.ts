import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankAccountRow, BankTransaction } from "@homeup/core";

// Bank feeds (.docs/connectors.md): the one write path for every connector
// whose data is 'bank-transactions'. A connector maps what it reads (Up's API,
// a CSV statement) to core's BankAccountRow and BankTransaction shapes, with
// its manifest's `source`, and saves them here. Rows are keyed by source,
// person and the bank's own id, so reading the same payment again updates it
// instead of adding a copy. After saving, the connector calls applyBankLinks
// (lib/up-bank.ts) so link rules and filing cover the new payments.

/**
 * Saves one person's accounts from one source. With `prune`, accounts of that
 * source the read no longer lists (a closed saver) are removed.
 */
export async function saveBankAccounts(
  admin: SupabaseClient,
  owner: { userId: string },
  source: string,
  rows: readonly BankAccountRow[],
  opts: { prune?: boolean } = {},
): Promise<void> {
  const now = new Date().toISOString();
  if (rows.length) {
    const { error } = await admin
      .from("bank_accounts")
      .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "source,user_id,external_id" });
    if (error) console.warn(`[bank-feed] ${source} accounts not saved`, error.message);
  }
  if (!opts.prune) return;
  const listed = new Set(rows.map((r) => r.external_id));
  const { data: stored } = await admin.from("bank_accounts").select("id, external_id").eq("user_id", owner.userId).eq("source", source);
  const gone = (stored ?? []).filter((a) => !listed.has(a.external_id as string)).map((a) => a.id as string);
  if (gone.length) await admin.from("bank_accounts").delete().in("id", gone);
}

/** Saves transactions in batches of 500. Returns the first error's message, or null. */
export async function saveBankTransactions(admin: SupabaseClient, rows: readonly Omit<BankTransaction, "id">[]): Promise<string | null> {
  const now = new Date().toISOString();
  const write = (list: readonly Omit<BankTransaction, "id">[]) =>
    admin.from("bank_transactions").upsert(
      list.map((r) => ({ ...r, updated_at: now })),
      { onConflict: "source,user_id,external_id" },
    );
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    let res = await write(batch);
    // Code can run a few minutes ahead of its migration on the hosted server;
    // without the account_id column, save the rows without it.
    if (res.error && /account_id/.test(res.error.message)) {
      res = await write(batch.map(({ account_id: _accountId, ...rest }) => rest));
    }
    if (res.error) return res.error.message;
  }
  return null;
}

/** Removes everything one source saved for a person: their transactions, then their accounts. */
export async function removeBankFeed(admin: SupabaseClient, userId: string, source: string): Promise<string | null> {
  const { error } = await admin.from("bank_transactions").delete().eq("user_id", userId).eq("source", source);
  if (error) return error.message;
  await admin.from("bank_accounts").delete().eq("user_id", userId).eq("source", source);
  return null;
}
