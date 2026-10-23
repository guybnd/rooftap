'use client';

// Occasions: a gift idea's card, opened by tapping its row (Guy, 2026-10-23:
// "a proper card instead of a clumsy edit menu"). Look A with C's budget
// meter: the name and price on top, where it's at, the occasion's gift
// budget, then the best price, the budget line, the link and notes, and who
// it's kept from. Every part is edited right where it is and saves as it
// changes (core useGiftIdeaCard); "All details" opens the full form for who
// it's for and the occasion. Native twin: apps/mobile/src/features/occasions/idea-card.tsx.
import * as React from 'react';
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import { ArrowUpRight, Gift, XIcon } from 'lucide-react';
import {
  GIFT_IDEA_STATUSES,
  JOINT_ACCOUNT_GIFT_WARNING,
  confirmRemoveIdea,
  memberFirstName,
  useGiftIdeaCard,
  type GiftIdea,
  type GroupMember,
  type OccasionsApi,
} from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { LeadingTile } from '@/components/ui/leading-tile';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

const MICRO = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

export function IdeaCard({
  ideaId,
  onClose,
  onEditAll,
  api,
  currentUserId,
  members,
  profiles,
  features,
}: {
  ideaId: string;
  onClose: () => void;
  /** The full form, for who it's for and the occasion. */
  onEditAll: (idea: GiftIdea) => void;
  api: OccasionsApi;
  currentUserId: string | null;
  members: GroupMember[];
  profiles: MemberProfiles;
  features: { costs: boolean; shopper: boolean };
}) {
  const card = useGiftIdeaCard({ ideaId, api, currentUserId, memberIds: members.map((m) => m.user_id), profiles, features });
  const { idea, view } = card;
  const [open, setOpen] = React.useState(true);

  // Removed (here or on another device): the card goes too.
  React.useEffect(() => {
    if (!idea) onClose();
  }, [idea, onClose]);
  if (!idea || !view) return null;

  const close = () => {
    setOpen(false);
    window.setTimeout(onClose, 200);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => !next && close()}
      overlayClassName="bg-black/40 duration-200"
      className={cn(
        'flex-col bg-popover text-popover-foreground shadow-xl',
        'max-h-[92dvh] rounded-t-2xl border-t border-border',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border',
      )}
      handleClassName="px-0 py-3 mb-0 sm:hidden"
      popupProps={{ 'data-slot': 'gift-idea-card' }}
    >
      {(contentRef) => (
        <>
          <div ref={contentRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-none px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 sm:pt-5">
            {/* E1: the item leads with its section tile; name and price edit in place. */}
            <div className="flex items-start gap-3 pr-8">
              <LeadingTile sectionId="occasions" Icon={Gift} size="lg" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <SheetPrimitive.Title className="sr-only">{view.title}</SheetPrimitive.Title>
                <InlineText
                  value={idea.title}
                  onCommit={card.setTitle}
                  ariaLabel="Idea"
                  className="font-heading text-xl font-semibold leading-tight"
                />
                {view.context && <p className="px-1 text-[13px] text-muted-foreground">{view.context}</p>}
              </div>
              <InlineText
                value={idea.price_cents ? String(idea.price_cents / 100) : ''}
                display={view.price ?? undefined}
                onCommit={card.setPrice}
                placeholder="Price"
                ariaLabel="Price"
                inputMode="decimal"
                className="w-24 text-right font-heading text-xl font-semibold tabular-nums"
              />
            </div>

            <SegmentedControl
              options={[...GIFT_IDEA_STATUSES]}
              value={idea.status}
              onChange={card.setStatus}
              ariaLabel="Where it's at"
            />

            {view.meter && (
              <div className="space-y-2 rounded-2xl bg-muted/50 p-3.5">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-semibold">Gift budget</span>
                  <span className={cn('tabular-nums', view.meter.over ? 'text-destructive' : 'text-muted-foreground')}>{view.meter.label}</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="bg-foreground" style={{ width: `${view.meter.boughtShare * 100}%` }} />
                  <div className="bg-foreground/40" style={{ width: `${view.meter.ideaShare * 100}%` }} />
                </div>
                {view.meter.legend.length > 0 && (
                  <div className="flex gap-3.5 text-xs text-muted-foreground">
                    {view.meter.legend.map((l) => (
                      <span key={l.part} className="inline-flex items-center gap-1.5 tabular-nums">
                        <span className={cn('size-2 rounded-[2px]', l.part === 'bought' ? 'bg-foreground' : 'bg-foreground/40')} />
                        {l.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="divide-y divide-border border-y border-border">
              {card.hasWant ? (
                <Row label="Best price">
                  <span className="text-right text-sm">
                    <span className="tabular-nums">{view.bestPrice}</span>
                    {view.bestHint && <span className="block text-xs text-muted-foreground">{view.bestHint}</span>}
                  </span>
                </Row>
              ) : (
                features.shopper && (
                  <Row label="Watch the price" hint="Adds it to Shopper, kept from the same people.">
                    <Button type="button" variant="outline" size="sm" onClick={card.watchPrice}>
                      Watch
                    </Button>
                  </Row>
                )
              )}
              {features.costs && (
                <Row
                  label="In the budget"
                  hint={!idea.price_cents ? 'Add a price to put it in the budget.' : idea.hidden_from.length ? JOINT_ACCOUNT_GIFT_WARNING : 'A one-off purchase in Costs.'}
                >
                  <Switch checked={card.inBudget} onChange={card.setInBudget} label="In the budget" disabled={!idea.price_cents} />
                </Row>
              )}
              <Row label="Link">
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                  <InlineText
                    value={idea.url ?? ''}
                    onCommit={card.setUrl}
                    placeholder="Add a link"
                    ariaLabel="Link"
                    type="url"
                    className="min-w-0 flex-1 truncate text-right text-sm"
                  />
                  {idea.url && (
                    <a
                      href={idea.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open link"
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-muted"
                    >
                      <ArrowUpRight className="size-4" />
                    </a>
                  )}
                </div>
              </Row>
              {view.fromWishlist && <p className="py-3 text-sm text-muted-foreground">{view.fromWishlist}</p>}
              <div className="space-y-1 py-3">
                <p className="text-sm text-muted-foreground">Notes</p>
                <InlineText
                  multiline
                  value={idea.notes ?? ''}
                  onCommit={card.setNotes}
                  placeholder="Size, colour, where to get it"
                  ariaLabel="Notes"
                  className="text-sm leading-relaxed"
                />
              </div>
            </div>

            {card.others.length > 0 && (
              <div className="space-y-2">
                <p className={MICRO}>Keep it from</p>
                {card.others.map((userId) => {
                  const name = memberFirstName(userId, profiles);
                  return (
                    <div key={userId} className="flex min-h-9 items-center gap-3">
                      <span className="min-w-0 flex-1 text-sm">Keep it from {name}</span>
                      <Switch checked={idea.hidden_from.includes(userId)} onChange={(on) => card.keepFrom(userId, on)} label={`Keep it from ${name}`} />
                    </div>
                  );
                })}
                {card.hints.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {card.hints.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => void confirmRemoveIdea(api, idea)}>
                Remove idea
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onEditAll(idea)}>
                All details
              </Button>
            </div>
          </div>
          <SheetPrimitive.Close
            render={<Button type="button" variant="ghost" size="icon-sm" className="absolute right-3 top-9 sm:top-3" />}
            aria-label="Close"
          >
            <XIcon />
          </SheetPrimitive.Close>
        </>
      )}
    </BottomSheet>
  );
}

/** One line of the card: a label on the left, its control on the right, an optional note under. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 py-3">
      <div className="flex min-h-9 items-center gap-3">
        <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
        <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Text that edits in place: it reads as plain text, a click turns it into a
 * field, and it saves on Enter or when focus leaves. Escape puts it back.
 * `onCommit` may return false to keep the field open (a price it can't read).
 */
function InlineText({
  value,
  display,
  onCommit,
  placeholder,
  ariaLabel,
  className,
  multiline,
  inputMode,
  type,
}: {
  value: string;
  display?: string;
  onCommit: (text: string) => boolean | void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  type?: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [bad, setBad] = React.useState(false);
  const editing = draft !== null;
  const field = cn(
    'w-full rounded-lg bg-transparent px-1 py-0.5 outline-none transition-colors',
    'hover:bg-muted/60 focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50',
    'placeholder:text-muted-foreground/70',
    bad && 'ring-2 ring-destructive/60',
    className,
  );

  const commit = () => {
    if (draft === null) return;
    if (onCommit(draft) === false) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setBad(false);
      setDraft(null);
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };
  const shown = editing ? draft : display !== undefined && value ? display : value;

  if (multiline) {
    return (
      <textarea
        aria-label={ariaLabel}
        value={shown}
        placeholder={placeholder}
        rows={Math.max(2, shown.split('\n').length)}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={keys}
        maxLength={300}
        className={cn(field, 'resize-none')}
      />
    );
  }
  return (
    <input
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      value={shown}
      placeholder={placeholder}
      inputMode={inputMode}
      type={type ?? 'text'}
      autoComplete="off"
      onFocus={(e) => {
        setDraft(value);
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
      maxLength={type === 'url' ? 500 : 120}
      className={field}
    />
  );
}
