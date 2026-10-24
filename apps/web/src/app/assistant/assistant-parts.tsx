'use client';

// HOUP-443: the pieces of an Assistant conversation on web: reply text (core's
// parseReply subset), a message bubble, the proposal card and the composer.
// The proposal card's Confirm is the one primary action on it (PC); its rows
// follow the three-slot line item (H6). Native twin:
// apps/mobile/src/features/assistant/assistant-parts.tsx.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, AtSign, Check, ChevronRight, ImageOff, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import {
  GHOST_REPLY_GROW_MS,
  GHOST_REPLY_LINES,
  GHOST_REPLY_STAGGER_MS,
  formatMicros,
  insertMention,
  mentionAt,
  parseReply,
  suggestMentions,
  type MentionOption,
  timeAgo,
  useComposerPhotos,
  useProposalPicks,
  useReplyItems,
  type ReplyItemRow,
  type AssistantDraft,
  type AssistantMessage,
  type AssistantPhoto,
  type OutgoingPhoto,
  type PickedPhoto,
  type ProposalPick,
  type ProposalState,
  type ReplySpan,
} from '@homeup/core';
import { cn } from '@/lib/utils';
import { sectionIconFor } from '@/lib/section-icons';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { useDataCache } from '@/lib/data-cache';
import { toast } from 'sonner';
import { assistantApi } from '@/lib/assistant-client';
import { createClient } from '@/lib/supabase/client';

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
        {message.photos?.length ? <MessagePhotos photos={message.photos} spaced={!!message.content} /> : null}
        {message.content ? <ReplyText text={message.content} /> : null}
        {!user && message.content ? <ReplyItems text={message.content} /> : null}
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

const ITEM_KIND_LABEL: Record<ReplyItemRow['kind'], string> = {
  recipe: 'Recipe',
  checklist: 'Checklist',
  watch: 'Watch',
  scout: 'Scout',
  listing: 'Listing',
};

/**
 * The items a reply links to, as line-item rows under it (H6), read live from
 * the household's stores: a ticked list item or a recipe kept from To try
 * shows here too. Click opens the item; right-click gives its row menu (§13.7).
 * The links stay in the text, so an item the stores lack still opens.
 */
function ReplyItems({ text }: { text: string }) {
  const { group, currentUserId } = useDataCache();
  const { rows, toggleToTry } = useReplyItems(group?.id, text, currentUserId);
  if (!rows.length) return null;
  return (
    <ListGroup className="mt-2.5">
      {rows.map((row) => (
        <ReplyItemLine key={row.key} row={row} onToggleToTry={row.kind === 'recipe' && toggleToTry ? () => toggleToTry(row.id) : undefined} />
      ))}
    </ListGroup>
  );
}

function ReplyItemLine({ row, onToggleToTry }: { row: ReplyItemRow; onToggleToTry?: () => void }) {
  const router = useRouter();
  const Icon = sectionIconFor(row.module);
  const rowMenu = useRowContextMenu(() => ({
    title: row.title,
    kind: ITEM_KIND_LABEL[row.kind],
    actions: [
      { id: 'open', label: 'Open', group: 'open', icon: 'open', run: () => router.push(row.href) },
      { id: 'copy', label: 'Copy link', group: 'share', icon: 'copy', run: () => void navigator.clipboard?.writeText(new URL(row.href, window.location.href).toString()) },
      onToggleToTry && { id: 'to-try', label: row.toTry ? 'Keep in recipes' : 'Move to To try', group: 'edit', icon: 'move', run: onToggleToTry },
    ],
  }));
  return (
    <ListItem onContextMenu={rowMenu.onContextMenu}>
      {rowMenu.menu}
      <Link href={row.href} onClick={navLinkClickHandler('descend', router, row.href)} className="flex min-w-0 flex-1 items-center gap-3">
        <LeadingTile sectionId={row.module} Icon={Icon} size="md" />
        <ListItemContent>
          <ListItemTitle>
            <span className="truncate text-foreground">{row.title}</span>
          </ListItemTitle>
          {row.meta && <ListItemMeta className={cn('tabular-nums', row.good && 'text-success')}>{row.meta}</ListItemMeta>}
        </ListItemContent>
        <ListItemTrailing>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </ListItemTrailing>
      </Link>
    </ListItem>
  );
}

/** Photos sent with a message: each opens full size; one past the keep time says so. */
function MessagePhotos({ photos, spaced }: { photos: AssistantPhoto[]; spaced: boolean }) {
  return (
    <div className={cn('flex flex-wrap justify-end gap-1.5', spaced && 'mb-2')}>
      {photos.map((p, i) =>
        p.url ? (
          <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset */}
            <img src={p.url} alt={`Photo ${i + 1}`} className="h-36 max-w-[14rem] object-cover" />
          </a>
        ) : (
          <div key={i} className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-xl bg-background/60 text-muted-foreground">
            <ImageOff className="h-4 w-4" />
            <span className="text-[11px]">No longer kept</span>
          </div>
        )
      )}
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

/** A picked or pasted file, as the shared photo tray takes it. */
function pickedFrom(file: File): PickedPhoto {
  return { preview: URL.createObjectURL(file), mimeType: file.type, size: file.size, read: async () => file };
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
}

/** The `@` suggestions over the composer: click one (or arrow to it and press Enter) to put the tag in. */
function MentionChips({ options, active, onPick }: { options: MentionOption[]; active: number; onPick: (option: MentionOption) => void }) {
  return (
    <div id="composer-mentions" role="listbox" aria-label="Tag someone" className="flex gap-2 overflow-x-auto px-1 pb-1.5 pt-0.5">
      {options.map((o, i) => (
        <button
          key={o.userId ?? o.name}
          id={`composer-mention-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          // Keep the textarea focused, so typing carries on after a click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(o)}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/60 px-3 text-sm hover:bg-muted',
            i === active ? 'bg-muted' : 'bg-background'
          )}
        >
          {o.kind === 'rooftap' ? <Sparkles className="h-3.5 w-3.5" /> : <AtSign className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="font-medium text-foreground">{o.name}</span>
          {o.kind === 'rooftap' && <span className="text-xs text-muted-foreground">ask it</span>}
        </button>
      ))}
    </div>
  );
}

export function Composer({
  placeholder,
  disabled,
  busy,
  autoFocus,
  maxLength = 4000,
  photos: allowPhotos = false,
  mentions,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /** Offer to attach photos (pick, paste or drop), when the household's model can look at them. */
  photos?: boolean;
  /** Who `@` offers to tag (the household thread): Rooftap and the other members. */
  mentions?: MentionOption[];
  onSend: (text: string, photos: OutgoingPhoto[]) => Promise<boolean> | boolean;
}) {
  const [text, setText] = useState('');
  // Where the caret is, for the `@` suggestions; arrows move `active`, Escape hides them until the next keystroke.
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const draft = mentions && !dismissed ? mentionAt(text, caret) : null;
  const suggestions = draft && mentions ? suggestMentions(mentions, draft.query) : [];
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));
  const pickMention = (option: MentionOption) => {
    const el = ref.current;
    if (!draft) return;
    const next = insertMention(text, draft, caret, option);
    setText(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };
  const trackCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionEnd ?? el.value.length);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tray = useComposerPhotos({
    api: assistantApi,
    supabase: allowPhotos ? createClient() : null,
    onError: (m) => toast.error(m),
    onRelease: (preview) => URL.revokeObjectURL(preview),
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const canSend = !disabled && !busy && !tray.uploading && (!!text.trim() || tray.outgoing.length > 0);

  const submit = async () => {
    const value = text.trim();
    if (!canSend) return;
    setCaret(0);
    const outgoing = tray.outgoing;
    const taken = tray.take();
    setText('');
    if (!(await onSend(value, outgoing))) {
      setText(value);
      tray.restore(taken);
    }
  };

  const attach = (files: File[]) => {
    if (!allowPhotos || disabled || files.length === 0) return;
    tray.add(files.map(pickedFrom));
  };

  return (
    <form
      className={cn(
        'rounded-3xl border border-border/60 bg-card p-1.5 shadow-[var(--card-shadow)]',
        !allowPhotos && 'pl-4',
        dragging && 'ring-2 ring-ring'
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onDragOver={(e) => {
        if (!allowPhotos || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!allowPhotos) return;
        e.preventDefault();
        setDragging(false);
        attach(imageFiles(e.dataTransfer.files));
      }}
    >
      {tray.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-2.5 pb-1.5 pt-1">
          {tray.photos.map((p) => (
            <div key={p.key} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file */}
              <img src={p.preview} alt="" className={cn('size-16 rounded-xl object-cover', (!p.path || p.failed) && 'opacity-50')} />
              {!p.path && !p.failed && (
                <Loader2 aria-label="Uploading" className="absolute inset-0 m-auto h-5 w-5 animate-spin text-foreground" />
              )}
              <button
                type="button"
                onClick={() => tray.remove(p.key)}
                aria-label="Remove photo"
                className="absolute -right-1.5 -top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-foreground text-background"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && <MentionChips options={suggestions} active={highlighted} onPick={pickMention} />}
      <div className="flex items-end gap-2">
        {allowPhotos && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                attach(imageFiles(e.target.files));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label="Attach a photo"
              disabled={disabled || tray.full}
              onClick={() => fileRef.current?.click()}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <ImagePlus className="h-5 w-5" />
            </button>
          </>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            trackCaret(e.target);
            setDismissed(false);
            setActive(0);
          }}
          onSelect={(e) => trackCaret(e.currentTarget)}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData.files);
            if (allowPhotos && files.length) {
              e.preventDefault();
              attach(files);
            }
          }}
          aria-autocomplete={mentions ? 'list' : undefined}
          aria-controls={suggestions.length > 0 ? 'composer-mentions' : undefined}
          aria-activedescendant={suggestions.length > 0 ? `composer-mention-${highlighted}` : undefined}
          onKeyDown={(e) => {
            if (suggestions.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setActive((highlighted + step + suggestions.length) % suggestions.length);
                return;
              }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault();
                pickMention(suggestions[highlighted]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDismissed(true);
                return;
              }
            }
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
          disabled={!canSend}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </div>
    </form>
  );
}
