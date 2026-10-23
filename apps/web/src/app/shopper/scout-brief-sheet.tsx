'use client';

// HOUP-435: the Scout brief (Hearth M4, a sheet with live controls). What
// they're after in their own words, a budget, when it's needed by and where
// they'll buy; "Find options" is the one primary (H2). A household without AI
// on its plan sees why and where to add its own key, never a dead button.
// Native twin: apps/mobile/src/features/shopper/scout-brief-sheet.tsx.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
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
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ShopperApiError, startScout } from '@/lib/shopper-api';
import { cn } from '@/lib/utils';
import { KeepFromField } from './keep-from-field';

const SCOUT_SECTION = { id: 'shopper', Icon: Sparkles };
const WHERE: ScoutWhere[] = ['nearby', 'online', 'secondhand'];
type NeedBy = (typeof SCOUT_NEED_BY_OPTIONS)[number]['value'];

export function ScoutBriefSheet({
  isOpen,
  currency,
  prefill,
  onClose,
}: {
  isOpen: boolean;
  currency: string;
  /** A brief handed over from another section (a Home Setup item). */
  prefill?: ScoutPrefill | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(prefill?.text ?? '');
  const [from, setFrom] = useState('');
  const [upTo, setUpTo] = useState(prefill?.upTo ?? '');
  const [needBy, setNeedBy] = useState<NeedBy>('none');
  const [where, setWhere] = useState<ScoutWhere[]>(['nearby', 'online']);
  const [hiddenFrom, setHiddenFrom] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; needsKey: boolean } | null>(null);
  const symbol = currencySymbol(currency);

  const toggle = (w: ScoutWhere) =>
    setWhere((prev) => (prev.includes(w) ? (prev.length > 1 ? prev.filter((x) => x !== w) : prev) : [...prev, w]));

  const submit = async () => {
    setSaving(true);
    setError(null);
    const days = SCOUT_NEED_BY_OPTIONS.find((o) => o.value === needBy)?.days ?? null;
    const id = crypto.randomUUID();
    try {
      await startScout(id, {
        text: text.trim(),
        budget_min_cents: parsePriceInput(from),
        budget_max_cents: parsePriceInput(upTo),
        need_by: days == null ? null : addDaysISO(todayISO(), days),
        where,
      }, hiddenFrom);
      onClose();
      router.push(`/shopper/scout/${id}`);
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
      section={SCOUT_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title="Scout"
      onSubmit={() => void submit()}
      submitLabel="Find options"
      saving={saving}
      canSubmit={text.trim().length >= 3}
    >
      <FormSection>
        <FieldRow label="What are you after" htmlFor="scout-text" hint="Say what matters: size, room, must-haves, what you'll use it for.">
          <textarea
            id="scout-text"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={SCOUT_BRIEF_MAX}
            rows={3}
            placeholder="A 65 inch TV for a bright lounge, mostly films and footy"
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Budget from" htmlFor="scout-from">
            <Input id="scout-from" inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={`${symbol}1,500`} />
          </FieldRow>
          <FieldRow label="Up to" htmlFor="scout-up-to">
            <Input id="scout-up-to" inputMode="decimal" value={upTo} onChange={(e) => setUpTo(e.target.value)} placeholder={`${symbol}2,000`} />
          </FieldRow>
        </div>
        <FieldRow label="Need it by">
          <SegmentedControl
            ariaLabel="Need it by"
            value={needBy}
            onChange={setNeedBy}
            options={SCOUT_NEED_BY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </FieldRow>
        <FieldRow label="Where">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Where">
            {WHERE.map((w) => {
              const on = where.includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(w)}
                  className={cn(
                    'inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors',
                    on ? 'border-transparent bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {SCOUT_WHERE_LABELS[w]}
                </button>
              );
            })}
          </div>
        </FieldRow>
        {error ? (
          <p className="text-sm text-destructive">
            {error.message}
            {error.needsKey && (
              <>
                {' '}
                <Link href="/settings/integrations" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onClose}>
                  Open AI keys
                </Link>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Uses your household&apos;s AI key or Plus. Takes about a minute.</p>
        )}
      </FormSection>
      <KeepFromField value={hiddenFrom} onChange={setHiddenFrom} />
    </ItemFormSheet>
  );
}
