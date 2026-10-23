// HOUP-435: the Scout brief (Hearth M4, a sheet with live controls). What
// they're after in their own words, a budget, when it's needed by and where
// they'll buy; "Find options" is the one primary (H2). A household without AI
// on its plan sees why and where to add its own key, never a dead button.
// Web twin: apps/web/src/app/shopper/scout-brief-sheet.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { ItemFormSheet, FormSection, FieldRow, Input, SegmentedControl, Text, cn } from '@homeup/ui';
import {
  SCOUT_BRIEF_MAX,
  SCOUT_NEED_BY_OPTIONS,
  SCOUT_WHERE_LABELS,
  addDaysISO,
  currencySymbol,
  isAiBlockedCode,
  parsePriceInput,
  todayISO,
  type ScoutPrefill,
  type ScoutWhere,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { KeepFromField } from './keep-from-field';
import { ShopperApiError, startScout } from './shopper-api';

const SCOUT_SECTION = { id: 'shopper', Icon: Sparkles };
const WHERE: ScoutWhere[] = ['nearby', 'online', 'secondhand'];
type NeedBy = (typeof SCOUT_NEED_BY_OPTIONS)[number]['value'];

export function ScoutBriefSheet({
  open,
  onOpenChange,
  currency,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** A brief handed over from another section (a Home Setup item). */
  prefill?: ScoutPrefill | null;
}) {
  const router = useRouter();
  const [text, setText] = React.useState(prefill?.text ?? '');
  const [from, setFrom] = React.useState('');
  const [upTo, setUpTo] = React.useState(prefill?.upTo ?? '');
  const [needBy, setNeedBy] = React.useState<NeedBy>('none');
  const [where, setWhere] = React.useState<ScoutWhere[]>(['nearby', 'online']);
  const [hiddenFrom, setHiddenFrom] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; needsKey: boolean } | null>(null);
  const symbol = currencySymbol(currency);

  const toggle = (w: ScoutWhere) =>
    setWhere((prev) => (prev.includes(w) ? (prev.length > 1 ? prev.filter((x) => x !== w) : prev) : [...prev, w]));

  const submit = async () => {
    setSaving(true);
    setError(null);
    const days = SCOUT_NEED_BY_OPTIONS.find((o) => o.value === needBy)?.days ?? null;
    const id = randomUUID();
    try {
      await startScout(id, {
        text: text.trim(),
        budget_min_cents: parsePriceInput(from),
        budget_max_cents: parsePriceInput(upTo),
        need_by: days == null ? null : addDaysISO(todayISO(), days),
        where,
      }, hiddenFrom);
      onOpenChange(false);
      router.push(`/shopper/scout/${id}` as Href);
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Could not start Scout.',
        needsKey: err instanceof ShopperApiError && isAiBlockedCode(err.code),
      });
      setSaving(false);
    }
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={SCOUT_SECTION}
      title="Scout"
      onSubmit={() => void submit()}
      submitLabel="Find options"
      saving={saving}
      canSubmit={text.trim().length >= 3}
    >
      <FormSection>
        <FieldRow label="What are you after" hint="Say what matters: size, room, must-haves, what you'll use it for.">
          <Input
            autoFocus
            value={text}
            onChangeText={setText}
            maxLength={SCOUT_BRIEF_MAX}
            multiline
            numberOfLines={3}
            placeholder="A 65 inch TV for a bright lounge, mostly films and footy"
          />
        </FieldRow>
        <View className="flex-row gap-2">
          <FieldRow label="Budget from" className="flex-1">
            <Input keyboardType="decimal-pad" value={from} onChangeText={setFrom} placeholder={`${symbol}1,500`} />
          </FieldRow>
          <FieldRow label="Up to" className="flex-1">
            <Input keyboardType="decimal-pad" value={upTo} onChangeText={setUpTo} placeholder={`${symbol}2,000`} />
          </FieldRow>
        </View>
        <FieldRow label="Need it by">
          <SegmentedControl
            accessibilityLabel="Need it by"
            value={needBy}
            onChange={setNeedBy}
            options={SCOUT_NEED_BY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </FieldRow>
        <FieldRow label="Where">
          <View className="flex-row flex-wrap gap-2" accessibilityRole="none">
            {WHERE.map((w) => {
              const on = where.includes(w);
              return (
                <Pressable
                  key={w}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(w)}
                  className={cn('h-9 justify-center rounded-full border px-3.5', on ? 'border-transparent bg-foreground' : 'border-border')}
                >
                  <Text className={cn('text-sm font-medium', on ? 'text-background' : 'text-muted-foreground')}>{SCOUT_WHERE_LABELS[w]}</Text>
                </Pressable>
              );
            })}
          </View>
        </FieldRow>
        {error ? (
          <Text className="text-sm text-destructive">
            {error.message}
            {error.needsKey && (
              <Text
                className="font-medium text-primary"
                accessibilityRole="link"
                onPress={() => {
                  onOpenChange(false);
                  router.push('/settings/integrations' as Href);
                }}
              >
                {' '}Open AI keys
              </Text>
            )}
          </Text>
        ) : (
          <Text className="text-xs text-muted-foreground">Uses your household&apos;s AI key or Plus. Takes about a minute.</Text>
        )}
      </FormSection>
      <KeepFromField value={hiddenFrom} onChange={setHiddenFrom} />
    </ItemFormSheet>
  );
}
