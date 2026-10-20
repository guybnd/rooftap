// FLUX-133: per-category sub-field schema for documents. Drives the metadata
// sub-form in capture + edit, and the read-only display on cards. Categories not
// listed here (incl. medical/prescription, by privacy decision) have no sub-fields.

import type { DocType } from './types';

export interface DocFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date';
}

export const CATEGORY_FIELDS: Partial<Record<DocType, DocFieldDef[]>> = {
  warranty: [
    { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'serial', label: 'Serial number', type: 'text' },
    { key: 'purchase_date', label: 'Purchase date', type: 'date' },
  ],
  insurance: [
    { key: 'provider', label: 'Provider', type: 'text' },
    { key: 'policy_no', label: 'Policy number', type: 'text' },
    { key: 'premium', label: 'Premium', type: 'text' },
  ],
  vehicle: [
    { key: 'rego', label: 'Rego / plate', type: 'text' },
    { key: 'make', label: 'Make', type: 'text' },
    { key: 'model', label: 'Model', type: 'text' },
  ],
  lease_contract: [
    { key: 'counterparty', label: 'Landlord / counterparty', type: 'text' },
    { key: 'property', label: 'Property / subject', type: 'text' },
    { key: 'start_date', label: 'Start date', type: 'date' },
  ],
};

/** Populated [label, value] pairs for read-only display. */
export function metadataSummary(
  docType: string,
  metadata: Record<string, unknown> | null | undefined
): Array<{ label: string; value: string }> {
  const fields = CATEGORY_FIELDS[docType as DocType];
  if (!fields || !metadata) return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const f of fields) {
    const v = metadata[f.key];
    if (v != null && String(v).trim() !== '') out.push({ label: f.label, value: String(v) });
  }
  return out;
}
