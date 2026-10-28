import { NextResponse } from "next/server";
import {
  CSV_IMPORT_MAX_ROWS,
  csvAccountId,
  csvBankConnector,
  csvDateSpan,
  csvTransactionIds,
  householdCurrency,
  isBankShareMode,
  type BankAccountRow,
  type BankImportInput,
  type BankImportResult,
  type BankImportSettings,
  type BankImportStatus,
  type BankTransaction,
  type CsvTransaction,
  type ImportedAccount,
} from "@homeup/core";
import { saveBankAccounts, saveBankTransactions } from "@/lib/connectors/bank-feed";
import { applyBankLinks, saveBankFeedSettings, shareModeOf, upConnectionRow, upRequest } from "@/lib/up-bank";

// Bank statement import (connector 'csv-bank', .docs/connectors.md):
// Settings > Connectors > Bank statement. The app reads the CSV on the device
// and sends the payments it found; this saves them for the caller through the
// shared bank feed path, as source 'csv', into an account named by the
// caller. Each person's imports are their own, like an Up connection: nobody
// else can list, change or remove them, and the household sees them only as
// the person's sharing choice allows. GET lists the caller's imported
// accounts and sharing, POST imports, PUT changes sharing, DELETE removes an
// account and its payments.

const SOURCE = csvBankConnector.source;

async function importStatus(req: { admin: Parameters<typeof upConnectionRow>[0]; userId: string }): Promise<BankImportStatus> {
  const [{ data: accounts }, { data: rows }, { data: settings }, up] = await Promise.all([
    req.admin.from("bank_accounts").select("external_id, name, ownership, updated_at").eq("user_id", req.userId).eq("source", SOURCE).order("created_at"),
    req.admin.from("bank_transactions").select("account_id, occurred_at").eq("user_id", req.userId).eq("source", SOURCE).limit(50_000),
    req.admin.from("bank_feed_settings").select("share_mode, auto_costs").eq("user_id", req.userId).maybeSingle(),
    upConnectionRow(req.admin, req.userId),
  ]);
  const byAccount = new Map<string, { count: number; from: string | null; to: string | null }>();
  for (const r of (rows ?? []) as { account_id: string | null; occurred_at: string }[]) {
    const day = r.occurred_at.slice(0, 10);
    const entry = byAccount.get(r.account_id ?? "") ?? { count: 0, from: null, to: null };
    entry.count += 1;
    if (!entry.from || day < entry.from) entry.from = day;
    if (!entry.to || day > entry.to) entry.to = day;
    byAccount.set(r.account_id ?? "", entry);
  }
  const list: ImportedAccount[] = ((accounts ?? []) as { external_id: string; name: string; ownership: string; updated_at: string }[]).map((a) => ({
    id: a.external_id,
    name: a.name,
    joint: a.ownership === "JOINT",
    count: byAccount.get(a.external_id)?.count ?? 0,
    from: byAccount.get(a.external_id)?.from ?? null,
    to: byAccount.get(a.external_id)?.to ?? null,
    updatedAt: a.updated_at,
  }));
  const mode = settings?.share_mode;
  return {
    accounts: list,
    shareMode: up ? shareModeOf(up) : isBankShareMode(mode) ? mode : "none",
    autoCosts: up?.auto_costs ?? settings?.auto_costs ?? false,
    upConnected: !!up,
  };
}

export async function GET() {
  const req = await upRequest();
  if ("error" in req) return req.error;
  return NextResponse.json(await importStatus(req));
}

function validRow(t: unknown): t is CsvTransaction {
  if (!t || typeof t !== "object") return false;
  const r = t as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    Number.isFinite(Date.parse(`${r.date}T00:00:00Z`)) &&
    typeof r.description === "string" &&
    r.description.trim().length > 0 &&
    r.description.length <= 500 &&
    Number.isSafeInteger(r.amountCents) &&
    (r.balanceCents === null || r.balanceCents === undefined || Number.isSafeInteger(r.balanceCents))
  );
}

export async function POST(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = (await request.json().catch(() => null)) as BankImportInput | null;
  const name = typeof body?.accountName === "string" ? body.accountName.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) return NextResponse.json({ error: "Give the account a name of up to 60 characters." }, { status: 400 });
  if (typeof body?.joint !== "boolean") return NextResponse.json({ error: "Say whether it is a joint account." }, { status: 400 });
  const list = Array.isArray(body.transactions) ? body.transactions : [];
  if (!list.length) return NextResponse.json({ error: "There are no payments in that file." }, { status: 400 });
  if (list.length > CSV_IMPORT_MAX_ROWS) {
    return NextResponse.json({ error: `One file can have up to ${CSV_IMPORT_MAX_ROWS.toLocaleString("en")} payments. Export a shorter stretch.` }, { status: 400 });
  }
  if (!list.every(validRow)) return NextResponse.json({ error: "Some payments in that file couldn't be read." }, { status: 400 });

  const accountId = csvAccountId(name);
  const { data: group } = await req.admin.from("groups").select("region, currency").eq("id", req.groupId).maybeSingle();
  const currency = householdCurrency(group as { region?: string | null; currency?: string | null } | null);
  const ids = csvTransactionIds(accountId, list);
  // The latest payment that carries a balance gives the account's balance.
  const latest = list.reduce<CsvTransaction | null>(
    (best, t) => (t.balanceCents !== null && t.balanceCents !== undefined && (!best || t.date >= best.date) ? t : best),
    null,
  );
  const account: BankAccountRow = {
    user_id: req.userId,
    group_id: req.groupId,
    source: SOURCE,
    external_id: accountId,
    name,
    account_type: "TRANSACTIONAL",
    ownership: body.joint ? "JOINT" : "INDIVIDUAL",
    balance_cents: latest?.balanceCents ?? 0,
    currency,
    has_balance: !!latest,
  };
  await saveBankAccounts(req.admin, { userId: req.userId }, SOURCE, [account]);

  const { data: known } = await req.admin
    .from("bank_transactions")
    .select("external_id")
    .eq("user_id", req.userId)
    .eq("source", SOURCE)
    .eq("account_id", accountId)
    .limit(50_000);
  const seen = new Set(((known ?? []) as { external_id: string }[]).map((r) => r.external_id));
  const rows: Omit<BankTransaction, "id">[] = list.map((t, i) => ({
    group_id: req.groupId,
    user_id: req.userId,
    source: SOURCE,
    external_id: ids[i],
    account_id: accountId,
    account_name: name,
    description: t.description.trim(),
    message: null,
    amount_cents: t.amountCents,
    currency,
    category: null,
    parent_category: null,
    status: "SETTLED",
    is_transfer: false,
    // Midday UTC keeps the payment on its own date in every time zone Costs groups by.
    occurred_at: `${t.date}T12:00:00.000Z`,
    settled_at: `${t.date}T12:00:00.000Z`,
  }));
  const error = await saveBankTransactions(req.admin, rows);
  if (error) return NextResponse.json({ error: `The payments couldn't be saved: ${error}` }, { status: 500 });

  const span = csvDateSpan(list);
  try {
    await applyBankLinks(req.admin, req.groupId, { userId: req.userId, since: span ? `${span.from}T00:00:00.000Z` : undefined });
  } catch (err) {
    console.warn("[bank-import] links not applied", err instanceof Error ? err.message : err);
  }
  const existing = ids.filter((id) => seen.has(id)).length;
  const result: BankImportResult = { status: await importStatus(req), added: ids.length - existing, existing };
  return NextResponse.json(result);
}

export async function PUT(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const body = ((await request.json().catch(() => null)) ?? {}) as BankImportSettings;
  if (body.shareMode !== undefined && !isBankShareMode(body.shareMode)) {
    return NextResponse.json({ error: "Share nothing, joint accounts or everything." }, { status: 400 });
  }
  if (body.autoCosts !== undefined && typeof body.autoCosts !== "boolean") {
    return NextResponse.json({ error: "Filing payments as costs is on or off." }, { status: 400 });
  }
  const error = await saveBankFeedSettings(req.admin, req, { shareMode: body.shareMode, autoCosts: body.autoCosts }, { up: true });
  if (error) return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  if (body.autoCosts === true) await applyBankLinks(req.admin, req.groupId);
  return NextResponse.json(await importStatus(req));
}

export async function DELETE(request: Request) {
  const req = await upRequest();
  if ("error" in req) return req.error;
  const accountId = new URL(request.url).searchParams.get("account") ?? "";
  if (!accountId) return NextResponse.json({ error: "Say which account to remove." }, { status: 400 });
  const { error } = await req.admin
    .from("bank_transactions")
    .delete()
    .eq("user_id", req.userId)
    .eq("source", SOURCE)
    .eq("account_id", accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await req.admin.from("bank_accounts").delete().eq("user_id", req.userId).eq("source", SOURCE).eq("external_id", accountId);
  return NextResponse.json(await importStatus(req));
}
