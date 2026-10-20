'use client';

// FLUX-133: renders the per-category sub-fields for a document (warranty,
// insurance, vehicle, lease). Shared by the capture details step and the edit
// modal. Values are stored in documents.metadata (a flexible JSONB bag).

import { docTypeLabel } from '@/lib/documents';
import { CATEGORY_FIELDS } from '@homeup/core';
import type { DocType } from '@homeup/core';

interface MetadataSubFormProps {
  docType: DocType;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function MetadataSubForm({ docType, value, onChange }: MetadataSubFormProps) {
  const fields = CATEGORY_FIELDS[docType];
  if (!fields) return null;

  const set = (key: string, v: string) => onChange({ ...value, [key]: v });

  return (
    <div className="rounded-lg border border-border p-2.5">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{docTypeLabel(docType)} details</span>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">{f.label}</span>
            <input
              type={f.type}
              value={(value[f.key] as string) ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              onClick={f.type === 'date' ? (e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } } : undefined}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
