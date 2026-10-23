'use client';

// HOUP-443: the pieces of an Assistant conversation on web: reply text (core's
// parseReply subset), a message bubble, the proposal card and the composer.
// The proposal card's Confirm is the one primary action on it (PC); its rows
// follow the three-slot line item (H6). Native twin:
// apps/mobile/src/features/assistant/assistant-parts.tsx.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowUp, Check, X } from 'lucide-react';
import {
  GHOST_REPLY_GROW_MS,
  GHOST_REPLY_LINES,
  GHOST_REPLY_STAGGER_MS,
  formatMicros,
  parseReply,
  timeAgo,
  useProposalPicks,
  type AssistantDraft,
  type AssistantMessage,
  type ProposalPick,
  type ProposalState,
  type ReplySpan,
} from '@homeup/core';
import { cn } from '@/lib/utils';
import { sectionIconFor } from '@/lib/section-icons';
import { LeadingTile } from '@/components/ui/leading-tile';

function Spans({ spans }: { spans: ReplySpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.href?.startsWith('/')) {
          // An app route (a Scout run the assistant started) opens in place.
          return (
            <Link key={i} href={s.href} className="text-primary underline underline-offset-2">
              {s.text}
            </Link>
          );
        }
        if (s.href) {
          return (
            <a key={i} href={s.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {s.text}
            </a>
          );
        }
        if (s.bold) return <strong key={i} className="font-semibold">{s.text}</strong>;
        if (s.italic) return <em key={i}>{s.text}</em>;
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

export function ReplyText({ text }: { text: string }) {
  const blocks = parseReply(text);
  return (
    <div className="space-y-1.5 whitespace-pre-wrap break-words">
      {blocks.map((b, i) =>
        b.type === 'paragraph' ? (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        ) : (
          <div key={i} className="flex gap-2 pl-1">
            <span aria-hidden className="shrink-0 text-muted-foreground tabular-nums">
              {b.type === 'bullet' ? '•' : `${b.n}.`}
            </span>
            <span className="min-w-0">
              <Spans spans={b.spans} />
            </span>
          </div>
        )
      )}
    </div>
  );
}

const STATE_LABEL: Record<ProposalState, string> = { pending: 'Waiting', confirmed: 'Approved', declined: 'Not done', expired: 'Expired' };

export function ProposalCard({
  message,
  busy,
  onDecide,
}: {
  message: AssistantMessage;
  busy: boolean;
  onDecide: (decision: 'confirm' | 'decline', picks?: ProposalPick[]) => void;
}) {
  const proposal = message.proposal;
  const pick = useProposalPicks(proposal);
  if (!proposal || proposal.items.length === 0) return null;
  const pending = proposal.state === 'pending';
  const { choices, ticks, keptCount } = pick;
  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-muted/40">
      {pending ? (
        <div>
          {choices.map((c, i) => {
            const off = pick.isLeft(c.key);
            const Icon = sectionIconFor(c.module);
            // An entry's change is named once, above its first entry.
            const caption = c.group !== null && c.group !== choices[i - 1]?.group;
            const divider = i > 0 && (caption || c.group === null);
            return (
              <div key={c.key} className={cn(divider && 'border-t border-border/60')}>
                {caption && (
                  <div className="flex items-center gap-3 px-3 pt-2.5">
                    <LeadingTile sectionId={c.module} Icon={Icon} size="sm" />
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">{c.group}</p>
                  </div>
                )}
                <label
                  htmlFor={ticks ? `pick-${message.id}-${c.key}` : undefined}
                  className={cn('flex min-h-[48px] items-center gap-3 px-3 py-2', ticks && !busy && 'cursor-pointer')}>
                  {c.group === null ? <LeadingTile sectionId={c.module} Icon={Icon} size="sm" /> : <span className="w-7 shrink-0" />}
                  {c.text !== null ? (
                    <input
                      value={pick.textFor(c.key, c.text)}
                      onChange={(e) => pick.setText(c.key, e.target.value)}
                      disabled={busy || off}
                      aria-label="Name"
                      maxLength={200}
                      className={cn(
                        'min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm text-foreground outline-none hover:bg-muted focus:bg-muted',
                        off && 'text-muted-foreground line-through'
                      )}
                    />
                  ) : (
                    <p className={cn('min-w-0 flex-1 text-sm text-foreground', off && 'text-muted-foreground line-through')}>{c.label}</p>
                  )}
                  {ticks && (
                    <>
                      <input
                        id={`pick-${message.id}-${c.key}`}
                        type="checkbox"
                        checked={!off}
                        disabled={busy}
                        onChange={() => pick.toggle(c.key)}
                        aria-label={`Include ${c.text ?? c.label}`}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                          off ? 'border-border' : 'border-primary bg-primary'
                        )}
                      >
                        {!off && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                      </span>
                    </>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {proposal.items.map((item, i) => {
            const Icon = sectionIconFor(item.module);
            return (
              <div key={i} className="flex min-h-[52px] items-center gap-3 px-3 py-2.5">
                <LeadingTile sectionId={item.module} Icon={Icon} size="sm" />
                <p className="min-w-0 flex-1 text-sm text-foreground">{item.summary}</p>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 px-3 pb-3 pt-1">
        {pending ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide('decline')}
              className="inline-flex h-10 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={busy || keptCount === 0}
              onClick={() => onDecide('confirm', pick.picks())}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {pick.label}
            </button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {proposal.state === 'confirmed' ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5" />}
            {STATE_LABEL[proposal.state]}
          </span>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  showAuthor,
  showCost,
  busy,
  onDecide,
}: {
  message: AssistantMessage;
  showAuthor: boolean;
  showCost: boolean;
  busy: boolean;
  onDecide: (messageId: string, decision: 'confirm' | 'decline', picks?: ProposalPick[]) => void;
}) {
  const user = message.role === 'user';
  // Older servers don't say whose a message is: every user message was the viewer's.
  const mine = user && (message.mine ?? true);
  // In the household thread members are named, and so is Rooftap, so a reply reads apart from the chat.
  const author = !showAuthor || mine ? null : user ? message.author : 'Rooftap';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {author && <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{author}</p>}
      <div
        className={cn(
          'max-w-[88%] text-[15px] leading-relaxed text-foreground',
          mine ? 'rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5' : user ? 'rounded-2xl rounded-bl-md bg-muted/50 px-3.5 py-2.5' : 'w-full px-1'
        )}
      >
        <ReplyText text={message.content} />
        {!user && <ProposalCard message={message} busy={busy} onDecide={(d, picks) => onDecide(message.id, d, picks)} />}
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted-foreground tabular-nums">
        {timeAgo(message.created_at)}
        {message.channel === 'telegram' ? ' · Telegram' : ''}
        {showCost && message.cost_micros != null ? ` · ${formatMicros(message.cost_micros)}` : ''}
      </p>
    </div>
  );
}

/**
 * Rooftap working on a reply (Hearth §8 "Ghost reply"): faint lines grow
 * where the answer will sit, one after another, shimmering until it lands.
 * A streamed reply (HOUP-509, Hearth §8 "Streamed reply") says what the
 * tools are doing under the lines, then the answer replaces them as it is
 * written.
 */
export function Thinking({ draft }: { draft?: AssistantDraft | null }) {
  const text = draft?.text.trimStart() ?? '';
  if (text) {
    return (
      <div className="w-full px-1 text-[15px] leading-relaxed text-foreground" aria-live="polite" aria-busy="true">
        <ReplyText text={text} />
        {draft?.status && <p className="mt-1.5 text-[13px] text-muted-foreground">{draft.status}</p>}
      </div>
    );
  }
  return (
    <div className="w-full space-y-2 px-1 py-1.5" aria-label="Rooftap is thinking" role="status">
      {GHOST_REPLY_LINES.map((width, i) => (
        <div key={i} style={{ width: `${width * 100}%` }}>
          <div
            className="ghost-line h-3 rounded-full bg-muted-foreground/15"
            style={{ '--ghost-delay': `${i * GHOST_REPLY_STAGGER_MS}ms`, '--ghost-grow': `${GHOST_REPLY_GROW_MS}ms` } as CSSProperties}
          />
        </div>
      ))}
      {draft?.status && <p className="pt-1 text-[13px] text-muted-foreground">{draft.status}</p>}
    </div>
  );
}

export function Composer({
  placeholder,
  disabled,
  busy,
  autoFocus,
  maxLength = 4000,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  onSend: (text: string) => Promise<boolean> | boolean;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if (!value || disabled || busy) return;
    setText('');
    if (!(await onSend(value))) setText(value);
  };

  return (
    <form
      className="flex items-end gap-2 rounded-3xl border border-border/60 bg-card p-1.5 pl-4 shadow-[var(--card-shadow)]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        className="min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      <button
        type="submit"
        aria-label="Send"
        disabled={disabled || busy || !text.trim()}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </form>
  );
}
