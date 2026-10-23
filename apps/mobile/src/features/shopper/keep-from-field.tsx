// "Keep it from": one switch per other member, for a Scout search or a new
// watch that is a present. The database then hides it, its prices and its
// picks from them. Only offered when the server knows how (shopper.keep-from).
// Web twin: apps/web/src/app/shopper/keep-from-field.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { FormSection, Switch, Text } from '@homeup/ui';
import { memberFirstName, nameList, useModules } from '@homeup/core';
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
          <View key={m.user_id} className="flex-row items-center gap-3">
            <Text className="min-w-0 flex-1 text-sm text-foreground">Keep it from {name}</Text>
            <Switch
              checked={value.includes(m.user_id)}
              label={`Keep it from ${name}`}
              onChange={(on) => onChange(on ? [...value, m.user_id] : value.filter((id) => id !== m.user_id))}
            />
          </View>
        );
      })}
      <Text className="text-xs text-muted-foreground">
        {names.length ? `${nameList(names)} won't see it, its prices or its picks.` : "For a present: they won't see it, its prices or its picks."}
      </Text>
    </FormSection>
  );
}
