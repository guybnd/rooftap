// HOUP-83: native port of apps/web/src/components/documents/metadata-subform.tsx.
// Renders the per-category sub-fields (warranty/insurance/vehicle/lease) driven
// by core's CATEGORY_FIELDS. Shared by the capture details step and the edit
// sheet. Web's `<input type=date>` + showPicker() has no RN equivalent — date
// fields use the universal DateScrollField instead of a text Input.
import { View } from 'react-native';
import { Text, Input, DateScrollField } from '@homeup/ui';
import { CATEGORY_FIELDS, docTypeLabel, type DocType } from '@homeup/core';

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
    <View className="gap-2.5 rounded-lg border border-border p-2.5">
      <Text className="text-caption font-medium text-muted-foreground">{docTypeLabel(docType)} details</Text>
      <View className="gap-2.5">
        {fields.map((f) => (
          <View key={f.key} className="gap-1">
            <Text className="text-[11px] text-muted-foreground">{f.label}</Text>
            {f.type === 'date' ? (
              <DateScrollField value={(value[f.key] as string) ?? ''} onChange={(v) => set(f.key, v)} />
            ) : (
              <Input value={(value[f.key] as string) ?? ''} onChangeText={(v) => set(f.key, v)} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
