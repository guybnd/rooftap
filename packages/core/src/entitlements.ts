// Household plans and what each one allows (Plus tier plan:
// /mnt/project-files/analysis/plus-tier-and-ai-gating.md). Plans are per
// household, stored in `group_entitlements` (service-role writes only); a
// household with no row is on Free. Only document limits are wired up so far:
// the /api/storage route checks both when signing an R2 upload.

export type HouseholdPlan = 'free' | 'plus';

export interface GroupEntitlements {
  plan: HouseholdPlan;
  plan_expires_at: string | null;
  /** Comped household: unlimited everything, no upgrade prompts. */
  billing_exempt: boolean;
}

export type EntitlementTier = 'free' | 'plus' | 'exempt';

const MB = 1024 * 1024;

/**
 * Largest single document per tier. `exempt` is R2's single-upload ceiling
 * (5 GiB); anything bigger would need multipart uploads.
 */
export const DOCUMENT_FILE_LIMITS: Record<EntitlementTier, { bytes: number; label: string }> = {
  free: { bytes: 20 * MB, label: '20 MB' },
  plus: { bytes: 1024 * MB, label: '1 GB' },
  exempt: { bytes: 5000 * MB, label: '5 GB' },
};

/** Total document storage per household; null = unlimited. */
export const DOCUMENT_STORAGE_LIMITS: Record<EntitlementTier, { bytes: number; label: string } | null> = {
  free: { bytes: 2 * 1024 * MB, label: '2 GB' },
  plus: { bytes: 25 * 1024 * MB, label: '25 GB' },
  exempt: null,
};

/** The tier a household's row puts it on. A lapsed Plus plan counts as Free. */
export function entitlementTier(row: GroupEntitlements | null | undefined, now: Date = new Date()): EntitlementTier {
  if (!row) return 'free';
  if (row.billing_exempt) return 'exempt';
  if (row.plan === 'plus' && (!row.plan_expires_at || new Date(row.plan_expires_at) > now)) return 'plus';
  return 'free';
}

/** Per-file document cap for a household. */
export function documentFileLimit(row: GroupEntitlements | null | undefined, now?: Date) {
  return DOCUMENT_FILE_LIMITS[entitlementTier(row, now)];
}

/** Total document storage for a household; null = unlimited. */
export function documentStorageLimit(row: GroupEntitlements | null | undefined, now?: Date) {
  return DOCUMENT_STORAGE_LIMITS[entitlementTier(row, now)];
}
