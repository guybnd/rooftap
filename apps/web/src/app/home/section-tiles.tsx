'use client';

// ── FLUX-155: the smaller hub section tiles — Setup, Home Search ──
// Hearth v2: Costs & Budget and Documents left Home (Budget and Bills are
// Spaces of their own, money-spaces.tsx; Documents lives in its section).
// Each reads its section's existing store/data without leaving the hub.

import { use$ } from '@legendapp/state/react';
import { Hammer, LayoutDashboard, CalendarClock, Star } from 'lucide-react';
import type { Group, SetupItem, ApartmentWithScore, Appointment } from '@homeup/core';
import { formatRelativeDay, setupItems$, useReconnectSync, summarize } from '@homeup/core';
import { SegmentedBar } from '@/app/setup/segmented-bar';
import { HubTile, TileHeader, formatTime12h, pad2 } from './hub-shared';

// ── Home Setup ──────────────────────────────────────────────────────────────────
export function SetupTile({ group }: { group: Group }) {
  const items$ = setupItems$(group.id);
  useReconnectSync(items$);
  const items = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is SetupItem => !!i && !i.deleted)
  );
  const summary = summarize(items);
  const done = summary.total - summary.outstanding;

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
  const now = Date.now();
  const nextAppointment =
    appointments
      .filter((a) => a.status === 'scheduled' && new Date(a.scheduled_at).getTime() >= now)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] ?? null;

  const topListing =
    [...apartments]
      .filter((a) => !a.archived)
      .sort((a, b) => (b.score?.percentage ?? -1) - (a.score?.percentage ?? -1))[0] ?? null;

  const apptWhen = nextAppointment ? new Date(nextAppointment.scheduled_at) : null;
  const apptAddress = nextAppointment
    ? apartments.find((ap) => ap.id === nextAppointment.apartment_id)?.address ?? 'Viewing'
    : null;

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
