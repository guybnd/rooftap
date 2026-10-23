import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupDefaultShelfLife, lookupDefaultPriceCents, canonicalizeItemName } from './shelf-life-defaults';

/** A per-group override row from the grocery_item_library table. */
export interface LibraryOverride {
  item_name: string;
  shelf_life_days: number | null;
  typical_price_cents: number | null;
  aisle: string | null;
  /** FLUX-208: tombstone flag — hides a built-in from the catalog picker. */
  hidden?: boolean | null;
  /** FLUX-208: supports the catalog's "Last added" sort. */
  created_at?: string | null;
}

export interface ItemDefaults {
  days: number | null;
  priceCents: number | null;
  aisle: string | null;
}

/** Fetch all library overrides for a group. */
export async function fetchItemLibrary(supabase: SupabaseClient, groupId: string): Promise<LibraryOverride[]> {
  const { data } = await supabase
    .from('grocery_item_library')
    .select('item_name, shelf_life_days, typical_price_cents, aisle, hidden, created_at')
    .eq('group_id', groupId);
  return (data ?? []) as LibraryOverride[];
}

/** Build a canonical name → override lookup (singular/plural-insensitive). */
export function buildLibraryMap(overrides: LibraryOverride[]): Map<string, LibraryOverride> {
  return new Map(overrides.map((o) => [canonicalizeItemName(o.item_name), o]));
}

/** Resolve shelf life + typical price for a name: per-group override wins, else code defaults. */
export function resolveItemDefaults(name: string, library?: Map<string, LibraryOverride>): ItemDefaults {
  const l = canonicalizeItemName(name);
  let override: LibraryOverride | undefined;
  if (library) {
    override = library.get(l);
    if (!override && l.length >= 4) {
      for (const [k, v] of library) {
        if (k.length >= 4 && (l.includes(k) || k.includes(l))) { override = v; break; }
      }
    }
  }
  return {
    days: override?.shelf_life_days ?? lookupDefaultShelfLife(name),
    priceCents: override?.typical_price_cents ?? lookupDefaultPriceCents(name),
    aisle: override?.aisle ?? null,
  };
}

/** Upsert one field of a library entry without disturbing the other (partial merge). */
async function upsertLibrary(
  supabase: SupabaseClient,
  groupId: string,
  name: string,
  patch: Partial<Omit<LibraryOverride, 'item_name'>>,
) {
  await supabase
    .from('grocery_item_library')
    .upsert({ group_id: groupId, item_name: name, ...patch }, { onConflict: 'group_id,item_name' });
}

/** Record/refresh the typical price the household pays for an item (learn-on-edit). */
export async function learnItemPrice(
  supabase: SupabaseClient,
  groupId: string,
  name: string,
  cents: number | null,
): Promise<void> {
  if (!name.trim()) return;
  await upsertLibrary(supabase, groupId, name.trim(), { typical_price_cents: cents });
}

/**
 * Upsert an item's full learnable details (shelf life + typical price + aisle)
 * into the library in one merge — used when archiving an item so its details
 * survive removal from the active list and can be restored on re-add (FLUX-188).
 * Only defined fields are written, so a null aisle won't clobber a learned one.
 */
export async function learnItemLibrary(
  supabase: SupabaseClient,
  groupId: string,
  name: string,
  fields: { shelf_life_days?: number | null; typical_price_cents?: number | null; aisle?: string | null },
): Promise<void> {
  if (!name.trim()) return;
  const patch: Partial<Omit<LibraryOverride, 'item_name'>> = {};
  if (fields.shelf_life_days !== undefined) patch.shelf_life_days = fields.shelf_life_days;
  if (fields.typical_price_cents !== undefined) patch.typical_price_cents = fields.typical_price_cents;
  if (fields.aisle !== undefined && fields.aisle !== null && fields.aisle !== '') patch.aisle = fields.aisle;
  if (Object.keys(patch).length === 0) return;
  await upsertLibrary(supabase, groupId, name.trim(), patch);
}
