'use client';

// "Keep it from": one switch per other member, for a Scout search or a new
// watch that is a present. The database then hides it, its prices and its
// picks from them. Only offered when the server knows how (shopper.keep-from).
// Native twin: apps/mobile/src/features/shopper/keep-from-field.tsx.
import { memberFirstName, nameList, useModules } from '@homeup/core';
import { FormSection } from '@/components/ui/item-form-sheet';
import { Switch } from '@/components/ui/switch';
import { useDataCache } from '@/lib/data-cache';

export function KeepFromField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const { groupMembers, memberProfiles, currentUserId } = useDataCache();
  const modules = useModules();
  const others = groupMembers.filter((m) => m.user_id !== currentUserId);
  if (!modules.server('shopper.keep-from') || others.length === 0) return null;
  const names = value.map((id) => memberFirstName(id, memberProfiles));
  return (
    <FormSection title="Keep it from">
      {others.map((m) => {
        const name = memberFirstName(m.user_id, memberProfiles);
        return (
          <div key={m.user_id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 text-sm text-foreground">Keep it from {name}</span>
            <Switch
              checked={value.includes(m.user_id)}
              label={`Keep it from ${name}`}
              onChange={(on) => onChange(on ? [...value, m.user_id] : value.filter((id) => id !== m.user_id))}
            />
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {names.length ? `${nameList(names)} won't see it, its prices or its picks.` : 'For a present: they won’t see it, its prices or its picks.'}
      </p>
    </FormSection>
  );
}
