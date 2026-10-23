'use client';

// The proposal card's ticks and edited names, shared by the web and native
// cards so both count, label and send a pick the same way.
import { useMemo, useState } from 'react';
import type { AssistantMessage } from './assistant-api';
import { proposalChoices, type ProposalPick } from './proposal-picks';

export function useProposalPicks(proposal: AssistantMessage['proposal']) {
  const choices = useMemo(() => proposalChoices(proposal?.items ?? []), [proposal]);
  // Rows the person unticked, and names they changed, by choice key.
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const [texts, setTexts] = useState<Record<string, string>>({});
  const kept = choices.filter((c) => !left.has(c.key));
  const edited = kept.some((c) => c.text !== null && (texts[c.key] ?? c.text).trim() !== c.text);
  return {
    choices,
    /** Ticks show only when there is more than one row to choose from. */
    ticks: choices.length > 1,
    isLeft: (key: string) => left.has(key),
    toggle: (key: string) =>
      setLeft((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    textFor: (key: string, text: string) => texts[key] ?? text,
    setText: (key: string, text: string) => setTexts((m) => ({ ...m, [key]: text })),
    keptCount: kept.length,
    /** The confirm button: "Do all 3" when everything is kept, "Do 2" for some, "Do it" for one. */
    label: kept.length === choices.length && choices.length > 1 ? `Do all ${choices.length}` : kept.length > 1 ? `Do ${kept.length}` : 'Do it',
    /** What a confirm sends: nothing extra when every row is kept as it was, else the kept rows. */
    picks: (): ProposalPick[] | undefined =>
      left.size === 0 && !edited
        ? undefined
        : kept.map((c) => {
            const text = texts[c.key]?.trim();
            return text && text !== c.text ? { key: c.key, text } : { key: c.key };
          }),
  };
}
