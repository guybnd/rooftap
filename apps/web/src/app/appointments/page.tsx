"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarDays, Download, ChevronDown, CheckCircle2, ExternalLink, Pencil, Map, Plus } from "lucide-react";
import Link from "next/link";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { AppointmentModal } from "@/components/appointment-modal";
import { CalendarSuggestions } from "@/components/calendar-suggestions";
import { WaypointCard } from "@/components/waypoint-card";
import { ListItem, ListGroup } from "@/components/ui/list-item";
import type { WaypointCardAction } from "@/components/waypoint-card";
import { TransitLeg, TransitLegNoRoute } from "@/components/transit-leg";
import { useMultiRoute } from "@/hooks/use-multi-route";
import { appointments$, apartmentComments$, apartments$, agents$, formatRelativeDay, toISODate, useModules, useReconnectSync, useStoreHelpers, useStoreLoaded } from "@homeup/core";
import { downloadIcs } from "@/lib/ics";
import type { Agent, Apartment, ApartmentComment, Appointment, ApartmentWithScore } from '@homeup/core';
import { PulseTile } from "@/components/ui/pulse-tile";
import { HeroLede } from "@/components/ui/hero-lede";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** H6: a 12-hour clock time, "10:30 AM" (never "10:30 am" or a 24h pair). */
function clockTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** H6: a relative day read mid-caption ("Next: tomorrow 6:30 PM"). Today and
 * Tomorrow drop their capital; weekday and dated labels keep theirs. Mirrors
 * apps/mobile/src/app/(tabs)/appointments/index.tsx. */
function relativeDayFragment(date: Date): string {
  const day = formatRelativeDay(date);
  return day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day;
}

function DayGroup({
  appointments,
  apartments,
  agents,
  durationMinutes,
  latestComments,
  memberProfiles,
  onEdit,
  onToggleViewed,
  onCycleStatus,
  onExport,
  onAddComment,
}: {
  appointments: Appointment[];
  apartments: ApartmentWithScore[];
  agents: { id: string; name: string; phone: string | null; color: string }[];
  durationMinutes: number;
  latestComments: Record<string, { content: string; user_id: string; created_at: string }[]>;
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  onEdit: (a: Appointment) => void;
  onToggleViewed: (a: Appointment) => void;
  onCycleStatus: (a: Appointment) => void;
  onExport: (a: Appointment) => void;
  onAddComment: (apartmentId: string, content: string) => Promise<void>;
}) {
  const router = useRouter();

  const waypoints = useMemo(() => {
    return appointments
      .map((appt) => {
        const apt = apartments.find((a) => a.id === appt.apartment_id);
        return apt && apt.lat != null && apt.lng != null ? { appointment: appt, apartment: apt } : null;
      })
      .filter((w): w is { appointment: Appointment; apartment: ApartmentWithScore } => w != null);
  }, [appointments, apartments]);

  const activeWaypoints = useMemo(() => {
    return waypoints.filter((w) => w.appointment.status === "scheduled");
  }, [waypoints]);

  const coords = useMemo(
    () => activeWaypoints.map((w) => ({ lng: w.apartment.lng!, lat: w.apartment.lat! })),
    [activeWaypoints]
  );

  const { allRoutes } = useMultiRoute(coords);

  const firstDate = new Date(appointments[0].scheduled_at);
  const dateLabel = formatRelativeDay(firstDate);
  const dateStr = toISODate(firstDate);

  return (
    <div>
      {/* Sticky, but no opaque fill: a solid band read as a stray box over the
          section glow; the blur alone keeps the label legible once stuck. */}
      <div className="sticky top-0 z-10 backdrop-blur-md py-1 mb-1 flex items-center">
        {/* Hearth v2 (H2): a day header is a muted micro label like the Home
            feed's, not coral (coral means interactive). */}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{dateLabel}</span>
        <span className="text-xs tabular-nums text-muted-foreground ml-2">
          {appointments.length} viewing{appointments.length !== 1 ? "s" : ""}
        </span>
        <Link
          href={`/map?date=${dateStr}`}
          className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Map className="h-3.5 w-3.5" />
          Map view
        </Link>
      </div>
      <div className="space-y-0">
        {waypoints.map((w) => {
          const time = clockTime(new Date(w.appointment.scheduled_at));
          const endDate = new Date(new Date(w.appointment.scheduled_at).getTime() + durationMinutes * 60000);
          const endTime = clockTime(endDate);
          const agent = agents.find((a) => a.id === w.apartment.agent_id);
          const isViewed = w.appointment.status === "viewed";
          const isSkipped = w.appointment.status === "skipped";
          const isOptional = w.appointment.status === "optional";
          const isRebook = w.appointment.status === "rebook";
          const isExcluded = isSkipped || isOptional || isRebook;
          const activeIdx = activeWaypoints.findIndex((aw) => aw.appointment.id === w.appointment.id);

          let transitLeg = null;
          if (!isExcluded && activeIdx >= 0 && activeIdx < activeWaypoints.length - 1) {
            const next = activeWaypoints[activeIdx + 1];
            const legIdx = activeIdx;
            const hasAnyRoute = allRoutes.walking?.legs[legIdx] || allRoutes.cycling?.legs[legIdx] || allRoutes.driving?.legs[legIdx];

            if (hasAnyRoute) {
              const departureTime = new Date(new Date(w.appointment.scheduled_at).getTime() + durationMinutes * 60000);
              const nextAppointmentTime = new Date(next.appointment.scheduled_at);

              transitLeg = (
                <TransitLeg
                  departureTime={departureTime}
                  nextAppointmentTime={nextAppointmentTime}
                  modes={{
                    walking: allRoutes.walking?.legs[legIdx]
                      ? { seconds: allRoutes.walking.legs[legIdx].duration, label: "walk" }
                      : null,
                    cycling: allRoutes.cycling?.legs[legIdx]
                      ? { seconds: allRoutes.cycling.legs[legIdx].duration, label: "bike" }
                      : null,
                    driving: allRoutes.driving?.legs[legIdx]
                      ? { seconds: allRoutes.driving.legs[legIdx].duration, label: "drive" }
                      : null,
                  }}
                />
              );
            } else if (next.apartment.lat == null || w.apartment.lat == null) {
              transitLeg = <TransitLegNoRoute message="Missing location data" />;
            } else {
              transitLeg = <TransitLegNoRoute />;
            }
          }

          // One labelled verb (Mark viewed) and icon-only secondaries, so the
          // row fits 390px without wrapping a label (F).
          const cardActions: WaypointCardAction[] = [];
          if (!isExcluded) {
            cardActions.push({
              label: isViewed ? "Viewed" : "Mark viewed",
              icon: <CheckCircle2 className={isViewed ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5 text-muted-foreground"} />,
              onClick: () => onToggleViewed(w.appointment),
              variant: isViewed ? "subtle" : "default",
            });
          }
          cardActions.push({
            label: "Open apartment",
            icon: <ArrowUpRight className="h-4 w-4" />,
            onClick: () => router.push(`/apartment/${w.apartment.id}`),
            iconOnly: true,
          });
          if (w.apartment.listing_url) {
            cardActions.push({
              label: "Open listing",
              icon: <ExternalLink className="h-4 w-4" />,
              href: w.apartment.listing_url,
              iconOnly: true,
            });
          }
          cardActions.push({
            label: "Edit viewing",
            icon: <Pencil className="h-4 w-4" />,
            onClick: () => onEdit(w.appointment),
            iconOnly: true,
          });

          const calAction: WaypointCardAction = {
            label: "Export to calendar",
            icon: <Download className="h-4 w-4" />,
            onClick: () => onExport(w.appointment),
          };

          const aptComments = (latestComments[w.apartment.id] || []).map((c) => {
            const profile = memberProfiles[c.user_id];
            return {
              content: c.content,
              avatar: profile?.avatar ?? null,
              name: profile?.name ?? profile?.email ?? null,
            };
          });

          return (
            <div key={w.appointment.id}>
              <div className="py-1">
                <div className={isViewed ? "opacity-60" : ""}>
                  <WaypointCard
                    index={isExcluded ? null : activeIdx >= 0 ? activeIdx : null}
                    time={time}
                    endTime={endTime}
                    apartment={w.apartment}
                    agent={agent ?? null}
                    isSkipped={isSkipped}
                    isOptional={isOptional}
                    isRebook={isRebook}
                    onStatusChange={(newStatus) => onCycleStatus({ ...w.appointment, status: newStatus })}
                    onNavigate={() => router.push(`/apartment/${w.apartment.id}`)}
                    actions={cardActions}
                    trailingAction={calAction}
                    comments={aptComments}
                    note={w.appointment.notes}
                    onAddComment={(content) => onAddComment(w.apartment.id, content)}
                  />
                </div>
              </div>
              {transitLeg}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AppointmentsPage() {
  const { userSettings, preliminaryScores, memberProfiles, currentUserId, group, loading } = useDataCache();
  const googleSuggestions = useModules().feature("search.google-suggestions");

  const appts$ = appointments$(group?.id);
  useReconnectSync(appts$);
  const { patchRow } = useStoreHelpers(appts$, currentUserId);

  const comments$ = apartmentComments$(group?.id);
  useReconnectSync(comments$);
  const { writeRow: writeComment } = useStoreHelpers(comments$, currentUserId);

  const apartmentsStore$ = apartments$(group?.id);
  useReconnectSync(apartmentsStore$);
  const agentsStore$ = agents$(group?.id);
  useReconnectSync(agentsStore$);

  const appointments = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const rawApartments = use$(() =>
    Object.values(apartmentsStore$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const commentRows = use$(() =>
    Object.values(comments$.get() ?? {}).filter((c): c is ApartmentComment => !!c && !c.deleted)
  );

  // preliminaryScores still comes from useDataCache (preliminary-score
  // migration is a separate slice, FLUX-150 slice 8 prep); apartments now
  // come from the Legend apartments$ store, mirroring homesearch/page.tsx.
  const apartments = useMemo<ApartmentWithScore[]>(() => {
    const prelimByApartment = new globalThis.Map<string, typeof preliminaryScores>();
    for (const ps of preliminaryScores) {
      const list = prelimByApartment.get(ps.apartment_id) ?? [];
      list.push(ps);
      prelimByApartment.set(ps.apartment_id, list);
    }
    return rawApartments.map((apt) => {
      const aptPrelimScores = prelimByApartment.get(apt.id) ?? [];
      const prelimAvg = aptPrelimScores.length > 0
        ? aptPrelimScores.reduce((sum, s) => sum + s.score, 0) / aptPrelimScores.length
        : null;
      return {
        ...apt,
        score: null,
        preliminaryScores: aptPrelimScores,
        preliminaryAvg: prelimAvg,
      };
    });
  }, [rawApartments, preliminaryScores]);

  // Mirrors data-cache.tsx's loadFromOfflineStore/fetchAll `latest[...]`
  // reducer: group by apartment, most-recent-first, top 3 per apartment.
  const latestComments = useMemo(() => {
    const byApartment = new globalThis.Map<string, ApartmentComment[]>();
    for (const c of commentRows) {
      const list = byApartment.get(c.apartment_id) ?? [];
      list.push(c);
      byApartment.set(c.apartment_id, list);
    }
    const result: Record<string, { content: string; user_id: string; created_at: string }[]> = {};
    for (const [apartmentId, list] of byApartment) {
      result[apartmentId] = list
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3)
        .map((c) => ({ content: c.content, user_id: c.user_id, created_at: c.created_at }));
    }
    return result;
  }, [commentRows]);

  const storeLoaded = useStoreLoaded(appts$, comments$, apartmentsStore$, agentsStore$);

  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newBookingApartmentId, setNewBookingApartmentId] = useState<string | null>(null);
  const [newBookingModalOpen, setNewBookingModalOpen] = useState(false);
  const [showApartmentPicker, setShowApartmentPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [showPast, setShowPast] = useState(false);

  const { upcomingGroups, past } = useMemo(() => {
    const now = new Date();
    const sorted = [...appointments].sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    );
    const upcomingList = sorted.filter((a) => new Date(a.scheduled_at) >= now);
    const pastList = sorted.filter((a) => new Date(a.scheduled_at) < now).reverse();

    const groups: Appointment[][] = [];
    for (const appt of upcomingList) {
      const dateStr = toISODate(new Date(appt.scheduled_at));
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && toISODate(new Date(lastGroup[0].scheduled_at)) === dateStr) {
        lastGroup.push(appt);
      } else {
        groups.push([appt]);
      }
    }

    return { upcomingGroups: groups, past: pastList };
  }, [appointments]);

  const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;

  const handleEdit = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setModalOpen(true);
  };

  const handleToggleViewed = (appointment: Appointment) => {
    const newStatus = appointment.status === "viewed" ? "scheduled" : "viewed";
    patchRow(appointment.id, { status: newStatus });
  };

  const handleCycleStatus = (appointment: Appointment) => {
    patchRow(appointment.id, { status: appointment.status });
  };

  const handleExport = async (appointment: Appointment) => {
    const apt = apartments.find((a) => a.id === appointment.apartment_id);
    if (!apt) return;
    try {
      await downloadIcs(
        {
          summary: `Viewing: ${apt.address}`,
          dtstart: new Date(appointment.scheduled_at),
          location: [apt.address, apt.suburb].filter(Boolean).join(", "),
          description: [appointment.notes, apt.listing_url].filter(Boolean).join("\n"),
        },
        apt.address
      );
    } catch {}
  };

  const handleAddComment = async (apartmentId: string, content: string) => {
    if (!currentUserId || !group?.id) return;
    writeComment({
      id: crypto.randomUUID(),
      group_id: group.id,
      apartment_id: apartmentId,
      user_id: currentUserId,
      content,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      deleted: false,
    });
  };

  if (loading || (!storeLoaded && appointments.length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-muted-foreground"></div>
      </div>
    );
  }

  const upcomingCount = upcomingGroups.reduce((sum, g) => sum + g.length, 0);

  // Hero lede caption (the next viewing) + pulse strip (Hearth 5 / FLUX-279).
  const upcomingFlat = upcomingGroups.flat();
  const nextAppt = upcomingFlat[0] ?? null;
  const nextApt = nextAppt ? apartments.find((a) => a.id === nextAppt.apartment_id) ?? null : null;
  const nextDate = nextAppt ? new Date(nextAppt.scheduled_at) : null;
  const weekFromNow = new Date(Date.now() + 7 * 86400000);
  const thisWeekCount = upcomingFlat.filter((a) => new Date(a.scheduled_at) <= weekFromNow).length;
  // No explicit "confirmed" field on Appointment — "optional" (booking you may
  // skip) is the closest existing status to a not-yet-firm booking; labelled
  // to match the real field rather than inventing an "unconfirmed" concept.
  const optionalCount = upcomingFlat.filter((a) => a.status === "optional").length;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      {/* Hearth v2 (Pulse, H1): the upcoming count is the page's Hero lede,
          the next viewing its caption; mirrors mobile's grammar. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <HeroLede
          value={upcomingCount}
          label="upcoming"
          caption={
            nextDate ? (
              <>
                Next: {relativeDayFragment(nextDate)}{" "}
                <span className="font-mono tabular-nums">{clockTime(nextDate)}</span>
                {nextApt?.address ? ` · ${nextApt.address}` : null}
              </>
            ) : undefined
          }
        />
        <button
          type="button"
          onClick={() => setShowApartmentPicker(true)}
          className={cn(buttonVariants(), "h-10 gap-1.5 rounded-xl px-3.5")}
        >
          <Plus className="h-4 w-4" />
          Book
        </button>
      </div>

      {/* H1: no Upcoming tile, the Hero already counts it; "This week" shows
          only when it says something the Hero doesn't (fewer than all), and
          "Optional" only when there are any (empty chrome hides at zero). */}
      {(() => {
        const showWeek = thisWeekCount > 0 && thisWeekCount < upcomingCount;
        const showOptional = optionalCount > 0;
        if (!showWeek && !showOptional) return null;
        return (
          <div className="grid grid-cols-2 gap-2">
            {showWeek && <PulseTile label="This week" value={thisWeekCount} />}
            {showOptional && <PulseTile label="Optional" value={optionalCount} tone="warning" />}
          </div>
        );
      })()}

      {/* Modules: viewing suggestions from Google need google-calendar (module-features.ts). */}
      {googleSuggestions && <CalendarSuggestions apartments={apartments} />}

      {showApartmentPicker && (
        <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading text-base font-semibold">Book a viewing</h3>
            <button
              type="button"
              onClick={() => { setShowApartmentPicker(false); setPickerSearch(""); }}
              className="-mr-2 inline-flex h-9 items-center rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <input
            type="text"
            placeholder="Search by address"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            autoFocus
            className="mb-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {apartments
              .filter((a) => !a.archived && (!pickerSearch.trim() || a.address.toLowerCase().includes(pickerSearch.toLowerCase()) || (a.suburb && a.suburb.toLowerCase().includes(pickerSearch.toLowerCase()))))
              .slice(0, 20)
              .map((apt) => (
                <button
                  key={apt.id}
                  type="button"
                  onClick={() => {
                    setNewBookingApartmentId(apt.id);
                    setNewBookingModalOpen(true);
                    setShowApartmentPicker(false);
                    setPickerSearch("");
                  }}
                  className="w-full min-h-11 text-left rounded-lg px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <span className="font-medium">{apt.address}</span>
                  {apt.suburb && <span className="text-muted-foreground">, {apt.suburb}</span>}
                </button>
              ))}
          </div>
        </div>
      )}

      {upcomingCount === 0 && past.length === 0 ? (
        // §11 empty state: centered, icon in a soft tile, one headline, one
        // short line (no dashed box). Its CTA is the Book button already on
        // the head row, so it doesn't repeat one (H5: one primary).
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="mb-4 rounded-2xl bg-primary/10 p-5">
            <CalendarDays className="h-7 w-7 text-primary" />
          </span>
          <p className="font-heading text-base font-semibold">No viewings booked</p>
          <p className="mt-1 text-sm text-muted-foreground">Book one for any listing you&apos;re tracking</p>
        </div>
      ) : (
        <div className="space-y-6">
          {upcomingGroups.map((group) => (
            <DayGroup
              key={toISODate(new Date(group[0].scheduled_at))}
              appointments={group}
              apartments={apartments}
              agents={agents}
              durationMinutes={durationMinutes}
              latestComments={latestComments}
              memberProfiles={memberProfiles}
              onEdit={handleEdit}
              onToggleViewed={handleToggleViewed}
              onCycleStatus={handleCycleStatus}
              onExport={handleExport}
              onAddComment={handleAddComment}
            />
          ))}

          {past.length > 0 && (
            <div className="pt-4">
              <button
                onClick={() => setShowPast(!showPast)}
                aria-expanded={showPast}
                className="-ml-2 mb-2 flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showPast ? "rotate-180" : ""}`} />
                Past viewings
                <span className="font-normal tabular-nums">{past.length}</span>
              </button>
              {showPast && (
                <ListGroup className="opacity-60">
                  {past.map((a) => {
                    const apt = apartments.find((ap) => ap.id === a.apartment_id);
                    if (!apt) return null;
                    const date = new Date(a.scheduled_at);
                    return (
                      <ListItem key={a.id} className="gap-3 py-2.5 text-sm">
                        <span className="truncate flex-1">{apt.address}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatRelativeDay(date)} · {clockTime(date)}
                        </span>
                      </ListItem>
                    );
                  })}
                </ListGroup>
              )}
            </div>
          )}
        </div>
      )}

      {editingAppointment && (
        <AppointmentModal
          open={modalOpen}
          onOpenChange={(open) => {
            setModalOpen(open);
            if (!open) setEditingAppointment(null);
          }}
          appointment={editingAppointment}
          apartmentId={editingAppointment.apartment_id}
        />
      )}

      {newBookingApartmentId && (
        <AppointmentModal
          open={newBookingModalOpen}
          onOpenChange={(open) => {
            setNewBookingModalOpen(open);
            if (!open) setNewBookingApartmentId(null);
          }}
          apartmentId={newBookingApartmentId}
        />
      )}
    </div>
  );
}
