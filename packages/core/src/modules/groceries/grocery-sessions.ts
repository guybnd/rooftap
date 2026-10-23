import type { SupabaseClient } from '@supabase/supabase-js';
import { learnItemPrice } from './item-library';
import type { GrocerySession, GroceryItem } from '../../types';
import type { DocumentUploadInput } from '../documents/documents';
import { isFeatureEnabled } from '../../module-features';
import { getEnabledModules } from '../../modules-store';

const BUCKET = 'cost-documents';

/** Local calendar day as YYYY-MM-DD. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "13 Jun" style label for a YYYY-MM-DD string. */
export function formatDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/** An item counts toward today's session if it was marked Got it today. */
export function isBoughtToday(item: GroceryItem, date = todayStr()): boolean {
  return item.status === 'bought' && (item.last_purchased_at ?? '').slice(0, 10) === date;
}

/** Effective total: manual override wins, then receipt, then the summed typical prices. */
export function effectiveSessionTotal(
  s: Pick<GrocerySession, 'override_total_cents' | 'receipt_total_cents' | 'summed_total_cents'>
): number {
  return s.override_total_cents ?? s.receipt_total_cents ?? s.summed_total_cents ?? 0;
}

export async function fetchTodaySession(supabase: SupabaseClient, groupId: string): Promise<GrocerySession | null> {
  const { data } = await supabase
    .from('grocery_sessions')
    .select('*')
    .eq('group_id', groupId)
    .eq('session_date', todayStr())
    .maybeSingle();
  return (data as GrocerySession) ?? null;
}

/** Create (or update tracking on) today's session. */
export async function ensureSession(
  supabase: SupabaseClient,
  groupId: string,
  tracking: 'on' | 'skipped',
  summedCents: number
): Promise<GrocerySession | null> {
  // getSession reads the stored session; getUser was an extra auth round trip
  // in front of the upsert, on the Track tap's critical path. created_by is
  // attribution only (RLS checks the group, not this field).
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('grocery_sessions')
    .upsert(
      { group_id: groupId, session_date: todayStr(), tracking, summed_total_cents: summedCents, created_by: session?.user.id },
      { onConflict: 'group_id,session_date' }
    )
    .select()
    .single();
  if (error) { console.error('ensureSession failed:', error.message ?? error); return null; }
  return data as GrocerySession;
}

/**
 * Freeze a session before converting its "Got it" items to "Have it" (FLUX-1559
 * "Done shopping"). Stamping `closed_at` makes the session-sync effect skip its
 * recompute (mirroring the existing `tracking !== 'on'` early-return), so
 * `summed_total_cents` — and the Costs line built from it — survive the flip.
 */
export async function closeSession(supabase: SupabaseClient, id: string): Promise<GrocerySession | null> {
  return updateSession(supabase, id, { closed_at: new Date().toISOString() });
}

export async function updateSession(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<GrocerySession>,
): Promise<GrocerySession | null> {
  const { data, error } = await supabase
    .from('grocery_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateSession failed:', error.message ?? error); return null; }
  return data as GrocerySession;
}

/**
 * Upsert the single Costs line for a session (actual, kept alongside the recurring
 * estimate). A session with no real spend — e.g. started by accident then undone —
 * produces NO cost line: any existing one is deleted so it doesn't linger in Costs
 * (and, because a grocery "actual" supersedes that month's estimate in the
 * projection, a $0 line would otherwise wipe out the month's grocery forecast).
 */
export async function syncCostLine(
  supabase: SupabaseClient,
  session: GrocerySession,
  groupId: string,
  /** False keeps an existing line in sync but never inserts one (Costs off). */
  createLine = true,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const amount = effectiveSessionTotal(session);

  // Resolve the live cost-line id from the DB, not the (possibly stale) local
  // session — another member may have created/linked it since this client read.
  let costItemId: string | null = session.cost_item_id ?? null;
  const { data: fresh } = await supabase
    .from('grocery_sessions')
    .select('cost_item_id')
    .eq('id', session.id)
    .maybeSingle();
  if (fresh) costItemId = (fresh.cost_item_id as string | null) ?? null;

  if (amount <= 0) {
    if (costItemId) {
      const { error } = await supabase.from('cost_items').delete().eq('id', costItemId);
      if (error) console.error('cost line delete failed:', error.message ?? error);
    }
    return null;
  }

  const name = `Groceries · ${formatDateLabel(session.session_date)}${session.retailer ? ` · ${session.retailer}` : ''}`;
  const payload = {
    group_id: groupId,
    name,
    category: 'grocery_estimate',
    amount,
    cadence: 'one_off',
    is_estimate: false,
    start_date: session.session_date,
    linked_section: 'groceries',
    provider: session.retailer ?? null,
    created_by: user?.id,
  };

  if (costItemId) {
    const { error } = await supabase.from('cost_items').update(payload).eq('id', costItemId);
    if (error) console.error('cost line update failed:', error.message ?? error);
  } else if (!createLine) {
    return null;
  } else {
    const { data, error } = await supabase.from('cost_items').insert(payload).select('id').single();
    if (!error) {
      costItemId = (data?.id as string) ?? null;
    } else if (error.code === '23505') {
      // Lost the insert race: the partial unique index (one grocery actual per
      // group/day) rejected us. Adopt the line the other member just created.
      const { data: existing } = await supabase
        .from('cost_items')
        .select('id')
        .eq('group_id', groupId)
        .eq('start_date', session.session_date)
        .eq('category', 'grocery_estimate')
        .eq('is_estimate', false)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from('cost_items').update(payload).eq('id', existing.id);
        costItemId = existing.id as string;
      } else {
        console.error('cost line insert failed:', error.message ?? error);
        return null;
      }
    } else {
      console.error('cost line insert failed:', error.message ?? error);
      return null;
    }
  }

  // Mirror the session's receipt photo onto the cost line so it's viewable in Costs.
  if (costItemId) await syncReceiptDocument(supabase, costItemId, session, user?.id ?? null);
  return costItemId;
}

/**
 * Keep the session's receipt photo mirrored as a `cost_documents` row on its
 * grocery cost line, so it shows under the line in the Costs document viewer.
 * Idempotent; removes stale receipt docs when the photo is replaced.
 */
async function syncReceiptDocument(
  supabase: SupabaseClient,
  costItemId: string,
  session: GrocerySession,
  userId: string | null,
): Promise<void> {
  if (!session.receipt_path || !userId) return; // cost_documents.uploaded_by is NOT NULL
  const { data } = await supabase
    .from('cost_documents')
    .select('id, storage_path')
    .eq('cost_item_id', costItemId)
    .eq('doc_type', 'receipt');
  const rows = (data ?? []) as { id: string; storage_path: string }[];

  const stale = rows.filter((r) => r.storage_path !== session.receipt_path).map((r) => r.id);
  if (stale.length) await supabase.from('cost_documents').delete().in('id', stale);

  if (!rows.some((r) => r.storage_path === session.receipt_path)) {
    const { error } = await supabase.from('cost_documents').insert({
      cost_item_id: costItemId,
      storage_path: session.receipt_path,
      filename: session.receipt_name ?? 'receipt',
      doc_type: 'receipt',
      uploaded_by: userId,
    });
    if (error) console.error('receipt cost-document link failed:', error.message ?? error);
  }
}

/**
 * Recompute the summed total, persist it, ensure a Costs line exists, and link it.
 * Returns the up-to-date session (with cost_item_id set).
 *
 * `writeCostLine` defaults to the household's switches right now, so callers
 * that don't pass it (capture flows) are covered too.
 */
export async function syncSession(
  supabase: SupabaseClient,
  session: GrocerySession,
  groupId: string,
  summedCents: number,
  // Modules: a shopping trip writing its cost line needs costs and groceries (module-features.ts).
  writeCostLine: boolean = isFeatureEnabled('costs.from-groceries', getEnabledModules()),
): Promise<GrocerySession> {
  const withSummed: GrocerySession = { ...session, summed_total_cents: summedCents };
  if (!writeCostLine && !session.cost_item_id) {
    // Costs is off and this trip has no cost line: keep the trip's own total
    // and write nothing into Costs.
    const updated = await updateSession(supabase, session.id, { summed_total_cents: summedCents });
    return updated ?? withSummed;
  }
  // Costs off with a line already linked: keep that line in sync (or remove it
  // at $0) so Costs is right when it comes back, but never insert a new one.
  const costItemId = await syncCostLine(supabase, withSummed, groupId, writeCostLine);
  const patch: Partial<GrocerySession> = { summed_total_cents: summedCents };
  // Persist link changes in both directions: a new line links, a removed one unlinks.
  if (costItemId !== (session.cost_item_id ?? null)) patch.cost_item_id = costItemId;
  const updated = await updateSession(supabase, session.id, patch);
  return updated ?? { ...withSummed, cost_item_id: costItemId };
}

/**
 * Upload a receipt image/PDF to the cost-documents bucket; returns its storage
 * path. HOUP-94: takes the platform-neutral `DocumentUploadInput` (mirrors the
 * `uploadDocument` seam HOUP-83 introduced) instead of a browser `File` — web
 * keeps a thin `File`-adapting wrapper (apps/web/src/lib/grocery-sessions.ts).
 */
export async function uploadReceipt(
  supabase: SupabaseClient,
  groupId: string,
  sessionDate: string,
  input: DocumentUploadInput
): Promise<{ path: string; name: string } | null> {
  const ext = input.filename.includes('.') ? input.filename.split('.').pop() : 'jpg';
  const path = `${groupId}/grocery-receipts/${sessionDate}-${Date.now()}.${ext}`;
  // Receipts stay in Supabase Storage; callers always pass an in-memory body.
  if (!input.body) return null;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.body, { upsert: true, contentType: input.mimeType ?? undefined });
  if (error) { console.error('receipt upload failed:', error.message ?? error); return null; }
  return { path, name: input.filename };
}

export interface ParsedReceipt {
  retailer?: string | null;
  purchase_date?: string | null;
  total?: number | null; // dollars
  line_items?: Array<{ name?: string; quantity?: number | null; unit_price?: number | null; total_price?: number | null }>;
}

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Learn prices from a parsed receipt: write each line item's unit price into the
 * shared library, and update the matching on-list item's price where we can.
 */
export async function applyReceiptLearning(
  supabase: SupabaseClient,
  groupId: string,
  parsed: ParsedReceipt,
  items: GroceryItem[]
): Promise<void> {
  const lines = parsed.line_items ?? [];
  if (!lines.length) return;

  for (const line of lines) {
    const name = (line.name ?? '').trim();
    const unit = line.unit_price ?? (line.total_price != null && line.quantity ? line.total_price / line.quantity : null);
    if (!name || unit == null || unit <= 0) continue;
    const cents = Math.round(unit * 100);
    await learnItemPrice(supabase, groupId, name, cents);

    // Update a matching list item's price (fuzzy by name).
    const l = norm(name);
    const match = items.find((i) => {
      const n = norm(i.name);
      return n === l || n.includes(l) || l.includes(n);
    });
    if (match) {
      await supabase.from('grocery_items').update({ price_cents: cents, last_price: cents }).eq('id', match.id);
    }
  }
}

/** Where the trip's total came from, for its caption. */
export function sessionTotalSource(session: GrocerySession): string {
  return session.override_total_cents != null ? 'manual total' : session.receipt_total_cents != null ? 'from receipt' : 'estimated';
}
