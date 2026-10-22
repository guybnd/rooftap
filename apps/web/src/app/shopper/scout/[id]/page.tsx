'use client';

// HOUP-435: one Scout run. While it researches, the head says so; once done
// the Hero counts the picks ("3 picks under $2,000", H1) with the stores
// checked and when, and each pick is a §6 row: rank, title, its role, store
// and stock, today's price trailing. A pick opens its sheet: why it fits,
// every source behind it, and the actions. Native twin:
// apps/mobile/src/app/shopper/scout/[id].tsx.
//
// Scout threads: the run is also a conversation. One composer at the bottom
// takes a question about the picks or a change to the search; Scout answers
// in words, or says what it changed and searches again, and the new picks
// land further down with the Hero counting them. The bubbles, ghost reply and
// composer are Assistant's, so the two read alike, but the thread is stored
// with the run and works with Assistant off.
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, MessageCircle, Sparkles, X } from 'lucide-react';
import {
  formatMoney,
  scoutBudgetLabel,
  scoutFailure,
  scoutHeadline,
  scoutPickAskLabel,
  scoutRunStatus,
  scoutStoresCaption,
  scoutTitle,
  timeAgo,
  useHouseholdCurrency,
  useModules,
  useScoutThread,
  SCOUT_FOLLOW_UP_MAX,
  type ScoutMessage,
  type ShopperPick,
  type ShopperSearch,
} from '@homeup/core';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { scoutRun, sendScoutFollowUp, watchScoutPick } from '@/lib/shopper-api';
import { Composer, ReplyText, Thinking } from '@/app/assistant/assistant-parts';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';

const API = { load: scoutRun, send: sendScoutFollowUp };

export default function ScoutRunPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const currency = useHouseholdCurrency();
  const canTalk = useModules().server('shopper.scout-thread');
  const { thread, root, latest, latestPicks, items, suggestions, pending, send, refresh } = useScoutThread(id, API);
  const [open, setOpen] = useState<ShopperPick | null>(null);
  const [about, setAbout] = useState<ShopperPick | null>(null);
  // Remounts the composer so it takes focus after "Ask about this".
  const [composerKey, setComposerKey] = useState(0);

  const back = (
    <Link
      href="/shopper"
      aria-label="Back to Shopper"
      className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={navLinkClickHandler('back', router, '/shopper')}
    >
      <ArrowLeft className="h-5 w-5" />
    </Link>
  );

  if (thread === undefined) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (thread === null || !root || !latest) {
    return (
      <div className="p-6 text-muted-foreground">
        Scout run not found.{' '}
        <Link href="/shopper" className="text-primary hover:text-primary/80">
          Back to Shopper
        </Link>
      </div>
    );
  }

  const firstStatus = scoutRunStatus(root);
  const status = scoutRunStatus(latest);
  const budget = scoutBudgetLabel(latest.brief);
  const headline = scoutHeadline(latestPicks, latest.brief);
  const caption = [scoutStoresCaption(latest), timeAgo(latest.finished_at)].filter(Boolean).join(' · ');
  const showComposer = canTalk && firstStatus !== 'running';

  const ask = async (text: string, pick: ShopperPick | null = about) => {
    try {
      await send(text, pick?.id ?? null);
      setAbout(null);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that.');
      return false;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24 md:p-6">
      <div className="flex items-center gap-2">
        {back}
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Scout · {scoutTitle(root.brief)}
        </p>
      </div>

      {status === 'running' && latest.id === root.id ? (
        <HeroLede
          value={<Sparkles className="h-10 w-10 animate-pulse text-muted-foreground motion-reduce:animate-none" aria-hidden />}
          label="Researching"
          caption="Checking your stores for the best fits. About a minute."
        />
      ) : status === 'failed' ? (
        <HeroLede value={0} label="picks" caption={scoutFailure(latest)} />
      ) : (
        <HeroLede value={headline.count} label={headline.caption} caption={caption || null} />
      )}

      <p className="text-sm text-muted-foreground">
        &ldquo;{latest.brief.text}&rdquo;
        {budget && <span className="tabular-nums"> · {budget}</span>}
      </p>

      {items.map((item) =>
        item.kind === 'run' ? (
          <RunBlock key={item.run.id} run={item.run} picks={item.picks} first={item.first} currency={currency} onOpen={setOpen} />
        ) : (
          <MessageRow key={item.message.id} message={item.message} picks={thread.picks} />
        ),
      )}

      {pending && (
        <>
          <div className="flex flex-col items-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-[15px] leading-relaxed">{pending.text}</div>
          </div>
          <Thinking />
        </>
      )}

      {showComposer && (
        // Sits above the tab bar like Assistant's composer.
        <div className="sticky bottom-20 z-20 md:bottom-4">
          <div className="space-y-2">
            {about ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2 text-sm">
                <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{scoutPickAskLabel(about)}</span>
                <button type="button" aria-label="Stop asking about this pick" onClick={() => setAbout(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              !pending &&
              suggestions.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask(s, null)}
                      className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )
            )}
            <Composer
              key={composerKey}
              autoFocus={composerKey > 0}
              placeholder={about ? 'Ask about this pick' : 'Ask or change the search'}
              maxLength={SCOUT_FOLLOW_UP_MAX}
              busy={!!pending}
              onSend={(text) => ask(text)}
            />
          </div>
        </div>
      )}

      {open && (
        <PickSheet
          pick={thread.picks.find((p) => p.id === open.id) ?? open}
          onClose={() => setOpen(null)}
          onWatched={refresh}
          onAsk={
            showComposer
              ? (pick) => {
                  setOpen(null);
                  setAbout(pick);
                  setComposerKey((n) => n + 1);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** A run in the thread: the first run's picks as they always were; a refined run under a "New picks" rule. */
function RunBlock({
  run,
  picks,
  first,
  currency,
  onOpen,
}: {
  run: ShopperSearch;
  picks: ShopperPick[];
  first: boolean;
  currency: string;
  onOpen: (pick: ShopperPick) => void;
}) {
  const status = scoutRunStatus(run);
  return (
    <div className="space-y-2">
      {!first && (
        <div className="flex items-center gap-2 px-1 pt-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">New picks</span>
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground tabular-nums">
            {status === 'running' ? 'Researching…' : status === 'failed' ? "Didn't finish" : scoutStoresCaption(run)}
          </span>
        </div>
      )}
      {!first && status === 'failed' && <p className="px-1 text-sm text-muted-foreground">{scoutFailure(run)}</p>}
      {picks.length > 0 && (
        <ListGroup>
          {picks.map((pick) => (
            <ListItem key={pick.id} asChild className="cursor-pointer">
              <button type="button" onClick={() => onOpen(pick)} className="text-left">
                <ListItemLeading>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-sm font-semibold tabular-nums text-foreground">
                    {pick.rank}
                  </span>
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>
                    <span className="truncate">{pick.title}</span>
                  </ListItemTitle>
                  <ListItemMeta>
                    <PickMeta pick={pick} />
                  </ListItemMeta>
                </ListItemContent>
                <ListItemTrailing>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(pick.price_cents, { currency: pick.currency || currency })}</span>
                </ListItemTrailing>
              </button>
            </ListItem>
          ))}
        </ListGroup>
      )}
    </div>
  );
}

function MessageRow({ message, picks }: { message: ScoutMessage; picks: ShopperPick[] }) {
  if (message.role === 'scout') {
    return (
      <div className="w-full px-1 text-[15px] leading-relaxed text-foreground">
        <ReplyText text={message.text} />
      </div>
    );
  }
  const pick = message.pick_id ? picks.find((p) => p.id === message.pick_id) : undefined;
  return (
    <div className="flex flex-col items-end gap-1">
      {pick && <span className="px-1 text-[11px] font-medium text-muted-foreground">{scoutPickAskLabel(pick)}</span>}
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-[15px] leading-relaxed">{message.text}</div>
    </div>
  );
}

function PickMeta({ pick }: { pick: ShopperPick }) {
  const parts = [pick.label, pick.store, pick.in_stock === true ? 'in stock' : pick.in_stock === false ? 'out of stock' : null].filter(Boolean);
  return (
    <>
      {pick.stretch && <span className="text-warning">Stretch · </span>}
      <span className="truncate">{parts.join(' · ')}</span>
    </>
  );
}

function PickSheet({
  pick,
  onClose,
  onWatched,
  onAsk,
}: {
  pick: ShopperPick;
  onClose: () => void;
  onWatched: () => void;
  onAsk?: (pick: ShopperPick) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const watch = async () => {
    setBusy(true);
    try {
      const want = await watchScoutPick(pick.id);
      onWatched();
      toast('Added to your watchlist.', { action: { label: 'Open', onClick: () => router.push(`/shopper/${want.id}`) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not watch it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open
      onOpenChange={(next) => !next && onClose()}
      overlayClassName="bg-black/40"
      className="max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4"
      handleClassName="sm:hidden"
      popupProps={{ 'aria-label': pick.title }}
    >
      <div className="space-y-4 pt-1">
        <div className="space-y-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {pick.stretch ? 'Stretch' : pick.label || `Pick ${pick.rank}`}
          </p>
          <p className="font-heading text-lg font-semibold leading-snug">{pick.title}</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(pick.price_cents, { currency: pick.currency })}</p>
          <p className="text-sm text-muted-foreground">
            {pick.store}
            {pick.in_stock === true ? ' · in stock' : pick.in_stock === false ? ' · out of stock' : ''}
          </p>
        </div>
        {pick.why && <p className="text-sm leading-relaxed">{pick.why}</p>}
        {pick.sources.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Sources</p>
            <ul className="space-y-1">
              {pick.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                    {s.title}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {onAsk && (
          <button
            type="button"
            onClick={() => onAsk(pick)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Ask Scout about this
          </button>
        )}
        <div className="grid grid-cols-2 gap-2 pb-1">
          {pick.url ? (
            <a href={pick.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Open at store
            </a>
          ) : (
            <span />
          )}
          {pick.want_id ? (
            <Button size="lg" variant="outline" onClick={() => router.push(`/shopper/${pick.want_id}`)}>
              Open in watchlist
            </Button>
          ) : (
            <Button size="lg" onClick={() => void watch()} disabled={busy}>
              {busy ? 'Adding…' : 'Watch the price'}
            </Button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
