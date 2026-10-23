'use client';

// ── FLUX-155: the smaller hub section tiles — Setup, Home Search ──
// Hearth v2: Costs & Budget and Documents left Home (Budget and Bills are
// Spaces of their own, money-spaces.tsx; Documents lives in its section).
// Each reads its section's existing store/data without leaving the hub.

import { useEffect, useState } from 'react';
import { Hammer, LayoutDashboard, CalendarClock, Star, ShoppingBag, Sparkles } from 'lucide-react';
import type { Group, ApartmentWithScore, Appointment } from '@homeup/core';
import {
  formatRelativeDay,
  homeSearchGlance,
  useSetupTileSummary,
  useShopperGlance,
  formatMoney,
  useHouseholdCurrency,
  DEAL_META,
  hitTarget,
  openAssistantPopup,
  setAssistantCounts,
} from '@homeup/core';
import { SegmentedBar } from '@/app/setup/segmented-bar';
import { assistantApi } from '@/lib/assistant-client';
import { useDesktopShell } from '@/lib/desktop-layout';
import { HubTile, TileHeader, formatTime12h, pad2 } from './hub-shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WantRow } from '@/app/shopper/want-row';
import { Sparkline } from '@/app/shopper/price-chart';

// ── Home Setup ──────────────────────────────────────────────────────────────────
export function SetupTile({ group }: { group: Group }) {
  const summary = useSetupTileSummary(group.id);
  const { done } = summary;

  return (
    <HubTile href="/setup" ariaLabel="Home setup">
      <TileHeader sectionId="setup" Icon={Hammer} title="Home Setup" />
      {summary.total === 0 ? (
        <p className="text-sm text-muted-foreground">No setup items yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {done}/{summary.total}
            </span>
            <span className="text-xs text-muted-foreground">purchased</span>
          </div>
          <SegmentedBar counts={summary.counts} />
        </div>
      )}
    </HubTile>
  );
}

// ── Home Search ─────────────────────────────────────────────────────────────────
export function HomeSearchTile({
  apartments,
  appointments,
}: {
  apartments: ApartmentWithScore[];
  appointments: Appointment[];
}) {
  const {
    nextAppointment,
    appointmentAt: apptWhen,
    appointmentAddress: apptAddress,
    topListing,
  } = homeSearchGlance(apartments, appointments, Date.now());

  return (
    <HubTile href="/homesearch" ariaLabel="Home search">
      <TileHeader sectionId="search" Icon={LayoutDashboard} title="Home Search" />
      <div className="flex flex-col gap-2.5 text-sm">
        <div className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          {nextAppointment && apptWhen ? (
            <div className="min-w-0">
              <div className="truncate text-foreground">{apptAddress}</div>
              <div className="text-xs text-muted-foreground">
                {formatRelativeDay(apptWhen)} · {formatTime12h(`${pad2(apptWhen.getHours())}:${pad2(apptWhen.getMinutes())}`)}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">No upcoming viewings</span>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Star className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          {topListing ? (
            <div className="min-w-0">
              <div className="truncate text-foreground">{topListing.address}</div>
              <div className="text-xs text-muted-foreground">
                {topListing.score ? `${topListing.score.percentage}% match` : 'Not yet scored'}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">No listings yet</span>
          )}
        </div>
      </div>
    </HubTile>
  );
}

// ── Shopper (HOUP-434) ──────────────────────────────────────────────────────────
// How many watched items are at a good price now, and the best of them.
// Expanded (Home's Shopper shortcut filters Home to it), the Space lists every
// watched item, good prices first, each opening its own page.
export function ShopperTile({ group, expanded = false }: { group: Group; expanded?: boolean }) {
  const currency = useHouseholdCurrency();
  const { rows, good, top } = useShopperGlance(group.id);

  if (expanded) {
    return (
      <section className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)] lg:col-span-3">
        <Link href="/shopper" className="block">
          <TileHeader sectionId="shopper" Icon={ShoppingBag} title="Shopper" />
        </Link>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing being watched.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground tabular-nums">
              {good.length} {good.length === 1 ? 'good deal' : 'good deals'} · {rows.length} watching
            </p>
            {/* One border level (Hearth): the rows sit on the Space's card, divided by hairlines. */}
            <div className="-mx-2 flex flex-col divide-y divide-border">
              {rows.map((row) => (
                <WantRow key={row.want.id} row={row} currency={currency} />
              ))}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <HubTile href={top ? `/shopper/${top.want.id}` : '/shopper'} ariaLabel="Shopper">
      <TileHeader sectionId="shopper" Icon={ShoppingBag} title="Shopper" />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing being watched.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-bold tracking-tight text-foreground tabular-nums">{good.length}</span>
            <span className="text-xs text-muted-foreground">
              {good.length === 1 ? 'good deal' : 'good deals'} · {rows.length} watching
            </span>
          </div>
          {top && top.want.best_cents != null && (
            <div className="flex items-end gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{top.want.title}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  <span className="text-success">
                    {hitTarget(top.want) ? 'Hit target' : top.verdict.rating ? DEAL_META[top.verdict.rating].label : ''}
                  </span>
                  {' · '}
                  {formatMoney(top.want.best_cents, { currency })}
                  {top.want.best_store ? ` at ${top.want.best_store}` : ''}
                </div>
              </div>
              {/* The same price trend the Shopper row carries. */}
              <Sparkline series={top.trend} rating={top.verdict.rating} />
            </div>
          )}
        </div>
      )}
    </HubTile>
  );
}

// ── Assistant (HOUP-443) ────────────────────────────────────────────────────────
// Only what waits on you: changes the assistant proposed that need your OK.
export function AssistantTile() {
  const shell = useDesktopShell();
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    assistantApi
      .status()
      .then((s) => {
        setAssistantCounts(s);
        if (live) setPending(s.access === 'none' || !s.ready ? null : s.pending);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    // Under the desktop top bar the tile opens the docked pop-up chat (Hearth §13.7).
    <HubTile
      href="/assistant"
      onActivate={shell ? () => openAssistantPopup() || router.push('/assistant') : undefined}
      ariaLabel="Assistant"
    >
      <TileHeader sectionId="assistant" Icon={Sparkles} title="Assistant" />
      {pending ? (
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-2xl font-bold tracking-tight text-foreground tabular-nums">{pending}</span>
          <span className="text-xs text-muted-foreground">{pending === 1 ? 'change waits on your OK' : 'changes wait on your OK'}</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ask about the week, the list or the bills.</p>
      )}
    </HubTile>
  );
}
