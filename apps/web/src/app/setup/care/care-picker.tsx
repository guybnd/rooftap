'use client';

// Home care: choose jobs from the suggestions. Only a couple start ticked,
// a whole group can be marked "Not for us" (no pool, no garden), and nothing
// is ever added without a tap here.

import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import {
  careEveryLabel,
  suggestionSchedule,
  useCarePicker,
  type CareJob,
  type CareSuggestion,
} from '@homeup/core';
import { ItemFormSheet } from '@/components/ui/item-form-sheet';
import { sectionIconFor } from '@/lib/section-icons';
import { cn } from '@/lib/utils';

const SETUP_SECTION = { id: 'setup', Icon: sectionIconFor('setup') };

export function CarePickerList({
  picker,
  southern,
}: {
  picker: ReturnType<typeof useCarePicker>;
  southern: boolean;
}) {
  const { groups, state, toggle, toggleSkip } = picker;
  if (groups.length === 0) {
    return <p className="px-1 py-4 text-sm text-muted-foreground">Every suggestion is already on your list.</p>;
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const skipped = state.skipped.has(g.area);
        return (
          <section key={g.area} aria-label={g.label} className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h3>
              <button
                type="button"
                onClick={() => toggleSkip(g.area)}
                aria-pressed={skipped}
                className={cn('text-xs font-medium', skipped ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
              >
                {skipped ? 'Show these' : 'Not for us'}
              </button>
            </div>
            {skipped ? (
              <p className="px-1 text-xs text-muted-foreground">Hidden. You can bring them back from the Hidden list.</p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-2xl bg-muted/40">
                {g.suggestions.map((s) => {
                  const on = state.picked.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(s.id)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                          on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {on && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{s.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {careEveryLabel(suggestionSchedule(s, southern), southern)}
                          {s.why ? ` · ${s.why}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function CarePickerSheet({
  isOpen,
  jobs,
  region,
  southern,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  jobs: readonly CareJob[];
  region: string | null | undefined;
  southern: boolean;
  onClose: () => void;
  onAdd: (picked: CareSuggestion[], hidden: CareSuggestion[]) => void;
}) {
  const picker = useCarePicker(jobs, region, false);
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) picker.reset();
    wasOpen.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const count = picker.state.picked.size;
  const hiding = picker.state.skipped.size > 0;
  return (
    <ItemFormSheet
      section={SETUP_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title="Add from suggestions"
      submitLabel={count > 0 ? `Add ${count} ${count === 1 ? 'job' : 'jobs'}` : hiding ? 'Save' : 'Add'}
      canSubmit={count > 0 || hiding}
      onSubmit={() => {
        const { picked, hidden } = picker.result();
        onAdd(picked, hidden);
        onClose();
      }}
    >
      <CarePickerList picker={picker} southern={southern} />
    </ItemFormSheet>
  );
}
