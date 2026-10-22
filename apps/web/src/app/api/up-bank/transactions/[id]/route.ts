import { NextResponse } from "next/server";
import { bankTransactionView, type BankTransaction } from "@homeup/core";
import { applyBankLinks, upRequest } from "@/lib/up-bank";

// Up Bank connector: change one of your own transactions. Hide it from
// spending, add a note, or file it under a cost line by hand (costItemId), or
// give it back to the link rules (costItemId: null). People who only see a
// transaction because its owner shares theirs can't change it.

type Params = { params: Promise<{ id: string }> };

const NOTE_MAX = 500;

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const req = await upRequest();
  if ("error" in req) return req.error;
  const { data: row } = await req.admin
    .from("bank_transactions")
    .select("*")
    .eq("id", id)
    .eq("group_id", req.groupId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.user_id !== req.userId) {
    return NextResponse.json({ error: "Only the person who connected this account can change it." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { hidden?: unknown; note?: unknown; costItemId?: unknown };
  const patch: Record<string, unknown> = {};
  if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
  if (body.note === null || typeof body.note === "string") {
    const note = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";
    patch.note = note || null;
  }
  let relink = false;
  if (body.costItemId === null) {
    patch.cost_item_id = null;
    patch.link_kind = null;
    relink = true;
  } else if (typeof body.costItemId === "string") {
    const { data: item } = await req.admin
      .from("cost_items")
      .select("id")
      .eq("id", body.costItemId)
      .eq("group_id", req.groupId)
      .maybeSingle();
    if (!item) return NextResponse.json({ error: "That cost line isn't in your household." }, { status: 400 });
    patch.cost_item_id = item.id;
    patch.link_kind = "manual";
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data: saved, error } = await req.admin
    .from("bank_transactions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !saved) return NextResponse.json({ error: error?.message ?? "Couldn't save." }, { status: 500 });

  // A payment given back to the rules gets whatever line they pick now; a
  // hidden or relinked payment can change a keep-in-step line's amount.
  if (relink || "hidden" in patch || "cost_item_id" in patch) {
    const at = Date.parse((saved as BankTransaction).occurred_at);
    await applyBankLinks(req.admin, req.groupId, { userId: req.userId, since: new Date(at - 1000).toISOString() });
  }
  const { data: fresh } = await req.admin.from("bank_transactions").select("*").eq("id", id).single();
  return NextResponse.json(bankTransactionView((fresh ?? saved) as BankTransaction, req.userId));
}
