'use client';

// HOUP-435: one Scout run. While it researches, the head says so; once done
// the Hero counts the picks ("3 picks under $2,000", H1) with the stores
// checked and when, and each pick is a §6 row: rank, title, its role, store
// and stock, today's price trailing. A pick opens its sheet: why it fits,
// every source behind it, and the actions. Native twin:
// apps/mobile/src/app/shopper/scout/[id].tsx.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Sparkles } from 'lucide-react';
import {
  formatMoney,
  scoutBudgetLabel,
  scoutFailure,
  scoutHeadline,
  scoutRunStatus,
  scoutStoresCaption,
  scoutTitle,
  timeAgo,
  useHouseholdCurrency,
  type ShopperPick,
  type ShopperSearch,
} from '@homeup/core';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { scoutRun, watchScoutPick } from '@/lib/shopper-api';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';

const POLL_MS = 3000;

export default function ScoutRunPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const currency = useHouseholdCurrency();
  const [search, setSearch] = useState<ShopperSearch | null | undefined>(undefined);
  const [picks, setPicks] = useState<ShopperPick[]>([]);
  const [open, setOpen] = useState<ShopperPick | null>(null);
  const [tick, setTick] = useState(0);

  const status = search ? scoutRunStatus(search) : null;

  useEffect(() => {
    let cancelled = false;
    scoutRun(id)
      .then((run) => {
        if (cancelled) return;
        setSearch(run.search);
        setPicks(run.picks);
      })
      .catch(() => !cancelled && setSearch((prev) => prev ?? null));
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  // Poll while it researches; the run lands in a minute or so.
  useEffect(() => {
    if (status !== 'running') return;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [status, tick]);

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

  if (search === undefined) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (search === null) {
    return (
      <div className="p-6 text-muted-foreground">
        Scout run not found.{' '}
        <Link href="/shopper" className="text-primary hover:text-primary/80">
          Back to Shopper
        </Link>
      </div>
    );
  }

  const budget = scoutBudgetLabel(search.brief);
  const headline = scoutHeadline(picks, search.brief);
  const caption = [scoutStoresCaption(search), timeAgo(search.finished_at)].filter(Boolean).join(' · ');
  const failure = scoutFailure(search);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex items-center gap-2">
        {back}
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Scout · {scoutTitle(search.brief)}
        </p>
      </div>

      {status === 'running' ? (
        <HeroLede
          value={<Sparkles className="h-10 w-10 animate-pulse text-muted-foreground motion-reduce:animate-none" aria-hidden />}
          label="Researching"
          caption="Checking your stores for the best fits. About a minute."
        />
      ) : status === 'failed' ? (
        <HeroLede value={0} label="picks" caption={failure} />
      ) : (
        <HeroLede value={headline.count} label={headline.caption} caption={caption || null} />
      )}

      <p className="text-sm text-muted-foreground">
        &ldquo;{search.brief.text}&rdquo;
        {budget && <span className="tabular-nums"> · {budget}</span>}
      </p>

      {picks.length > 0 && (
        <ListGroup>
          {picks.map((pick) => (
            <ListItem key={pick.id} asChild className="cursor-pointer">
              <button type="button" onClick={() => setOpen(pick)} className="text-left">
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

      {open && (
        <PickSheet
          pick={picks.find((p) => p.id === open.id) ?? open}
          onClose={() => setOpen(null)}
          onWatched={() => setTick((n) => n + 1)}
        />
      )}
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

function PickSheet({ pick, onClose, onWatched }: { pick: ShopperPick; onClose: () => void; onWatched: () => void }) {
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
