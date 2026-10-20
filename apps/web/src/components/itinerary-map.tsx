"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapGL, { Marker, Source, Layer, NavigationControl } from "react-map-gl/mapbox";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { calculateScore, apartments$, agents$, appointments$, apartmentComments$, apartmentChecklistItems$, apartmentChecklistResponses$, useReconnectSync, useStoreHelpers, compareStrings } from '@homeup/core';
import { TransitLeg, TransitLegNoRoute } from "@/components/transit-leg";
import { WaypointCard } from "@/components/waypoint-card";
import { useMultiRoute } from "@/hooks/use-multi-route";
import { useGeolocation } from "@/hooks/use-geolocation";
import type { TravelProfile } from "@/hooks/use-multi-route";
import type { Agent, Apartment, ApartmentComment, Appointment, ApartmentWithScore, ChecklistItem, ChecklistResponse } from '@homeup/core';
import "mapbox-gl/dist/mapbox-gl.css";


function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remaining = mins % 60;
  return remaining > 0 ? `${hrs}h ${remaining}m` : `${hrs}h`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function getBufferColor(bufferMinutes: number): string {
  if (bufferMinutes < 0) return "#ef4444";
  if (bufferMinutes < 10) return "#f59e0b";
  return "#10b981";
}

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getNextDateWithAppointments(appointments: Appointment[]): string {
  const todayStr = toLocalDateStr(new Date());

  const futureDates = appointments
    .filter((a) => a.status !== "viewed" && a.status !== "cancelled" && toLocalDateStr(new Date(a.scheduled_at)) >= todayStr)
    .map((a) => toLocalDateStr(new Date(a.scheduled_at)));

  const unique = [...new Set(futureDates)].sort();
  return unique[0] || todayStr;
}

export function ItineraryMap({ initialDate }: { initialDate?: string } = {}) {
  const router = useRouter();
  const { userSettings, memberProfiles, currentUserId, group } = useDataCache();

  const apts$ = apartments$(group?.id);
  const appts$ = appointments$(group?.id);
  const agentsStore$ = agents$(group?.id);
  const commentsStore$ = apartmentComments$(group?.id);
  const checklistItemsStore$ = apartmentChecklistItems$(group?.id);
  const checklistResponsesStore$ = apartmentChecklistResponses$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(appts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(commentsStore$);
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(checklistResponsesStore$);

  const rawApartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const appointments = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const comments = use$(() =>
    Object.values(commentsStore$.get() ?? {}).filter((c): c is ApartmentComment => !!c && !c.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );
  const responses = use$(() =>
    Object.values(checklistResponsesStore$.get() ?? {}).filter((r): r is ChecklistResponse => !!r && !r.deleted)
  );
  const { patchRow: patchAppointment } = useStoreHelpers(appts$, currentUserId);
  const { patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeComment } = useStoreHelpers(commentsStore$, currentUserId);

  // Derive score the same way homesearch/page.tsx does — checklistItems/responses
  // come from the Legend apartmentChecklist* stores (FLUX-150 slice 8 prep).
  const apartments = useMemo<ApartmentWithScore[]>(() => {
    const responsesByApartment = new Map<string, Record<string, boolean | null>>();
    for (const r of responses) {
      if (!responsesByApartment.has(r.apartment_id)) responsesByApartment.set(r.apartment_id, {});
      responsesByApartment.get(r.apartment_id)![r.checklist_item_id] = r.value;
    }
    return rawApartments.map((apt) => {
      const resp = responsesByApartment.get(apt.id) ?? {};
      const hasResponses = Object.keys(resp).length > 0;
      return {
        ...apt,
        score: hasResponses ? calculateScore(checklistItems, resp) : null,
      };
    });
  }, [rawApartments, checklistItems, responses]);

  // Latest 3 comments per apartment, newest first — mirrors the shape
  // data-cache.tsx used to derive before this page moved to the Legend store.
  const latestComments = useMemo(() => {
    const byApartment = new Map<string, ApartmentComment[]>();
    for (const c of comments) {
      const list = byApartment.get(c.apartment_id) ?? [];
      list.push(c);
      byApartment.set(c.apartment_id, list);
    }
    const result: Record<string, { content: string; user_id: string; created_at: string }[]> = {};
    for (const [apartmentId, list] of byApartment) {
      result[apartmentId] = [...list]
        .sort((a, b) => compareStrings(b.created_at, a.created_at))
        .slice(0, 3)
        .map((c) => ({ content: c.content, user_id: c.user_id, created_at: c.created_at }));
    }
    return result;
  }, [comments]);

  const [selectedDate, setSelectedDate] = useState<string>(initialDate || "");
  const [profile, setProfile] = useState<TravelProfile>("walking");
  const [includeOptional, setIncludeOptional] = useState(false);
  const [showMyLocation, setShowMyLocation] = useState(true);
  const { position: myPosition } = useGeolocation(showMyLocation);

  useEffect(() => {
    if (!selectedDate && appointments.length > 0) {
      setSelectedDate(getNextDateWithAppointments(appointments));
    }
  }, [appointments, selectedDate]);

  const dayAppointments = useMemo(() => {
    if (!selectedDate) return [];
    return appointments
      .filter(
        (a) => a.status !== "viewed" && a.status !== "cancelled" && toLocalDateStr(new Date(a.scheduled_at)) === selectedDate
      )
      .sort((a, b) => compareStrings(a.scheduled_at, b.scheduled_at));
  }, [appointments, selectedDate]);

  const aptMap = useMemo(() => {
    const map = new Map<string, ApartmentWithScore>();
    for (const apt of apartments) map.set(apt.id, apt);
    return map;
  }, [apartments]);

  const allWaypoints = useMemo(() => {
    const result: { appointment: Appointment; apartment: ApartmentWithScore }[] = [];
    for (const appt of dayAppointments) {
      const apt = aptMap.get(appt.apartment_id);
      if (apt && apt.lat != null && apt.lng != null) {
        result.push({ appointment: appt, apartment: apt });
      }
    }
    return result;
  }, [dayAppointments, aptMap]);

  const routeWaypoints = useMemo(() => {
    const result: { appointment: Appointment; apartment: ApartmentWithScore; index: number }[] = [];
    let idx = 0;
    for (const w of allWaypoints) {
      const st = w.appointment.status;
      if (st === "skipped" || st === "rebook" || (st === "optional" && !includeOptional)) continue;
      result.push({ ...w, index: idx++ });
    }
    return result;
  }, [allWaypoints, includeOptional]);

  const missingLocationCount = dayAppointments.length - allWaypoints.length;


  const routeWaypointCoords = useMemo(() => {
    const coords = routeWaypoints.map((w) => ({ lng: w.apartment.lng!, lat: w.apartment.lat! }));
    if (myPosition && showMyLocation) {
      return [{ lng: myPosition.lng, lat: myPosition.lat }, ...coords];
    }
    return coords;
  }, [routeWaypoints, myPosition, showMyLocation]);

  const { allRoutes, loading: loadingRoute, error: routeError } = useMultiRoute(routeWaypointCoords);
  const route = allRoutes[profile];

  const hasMyLocationInRoute = !!(myPosition && showMyLocation);
  const routeLegOffset = hasMyLocationInRoute ? 1 : 0;

  const initialViewState = useMemo(() => {
    const lats = allWaypoints.map((w) => w.apartment.lat!);
    const lngs = allWaypoints.map((w) => w.apartment.lng!);
    if (myPosition) {
      lats.push(myPosition.lat);
      lngs.push(myPosition.lng);
    }
    if (lats.length === 0) {
      return { longitude: 151.2093, latitude: -33.8688, zoom: 11 };
    }
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const spread = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
      0.005
    );
    const zoom = Math.min(14, Math.max(9, Math.floor(Math.log2(360 / spread) - 1)));
    return { longitude: centerLng, latitude: centerLat, zoom };
  }, [allWaypoints, myPosition]);

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
        Mapbox token not configured. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
        />
        <div className="flex rounded-lg border border-border overflow-hidden" role="radiogroup" aria-label="Travel mode for map route">
          {(["walking", "cycling", "driving"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProfile(p)}
              role="radio"
              aria-checked={profile === p}
              className={`px-4 py-2 text-sm font-medium transition-colors min-h-[36px] ${
                profile === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted active:bg-muted"
              }`}
            >
              {p === "walking" ? "Walk" : p === "cycling" ? "Bike" : "Drive"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowMyLocation((v) => !v)}
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors min-h-[36px] ${
            showMyLocation
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card hover:bg-muted border-border text-muted-foreground"
          }`}
        >
          📍 My Location
        </button>
        {loadingRoute && (
          <span className="text-xs text-muted-foreground animate-pulse">Calculating route...</span>
        )}
      </div>

      {missingLocationCount > 0 && (
        <p className="text-xs text-warning">
          {missingLocationCount} appointment{missingLocationCount > 1 ? "s" : ""} hidden (missing location data)
        </p>
      )}

      {routeError && (
        <p className="text-xs text-destructive">{routeError}</p>
      )}

      {dayAppointments.length === 0 ? (
        <div className="flex items-center justify-center h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
          No scheduled appointments on this date.
        </div>
      ) : (
        <div className="relative">
          <div className="h-[500px] sm:h-[600px] rounded-xl overflow-hidden border border-border">
            <MapGL
              initialViewState={initialViewState}
              mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
              mapStyle="mapbox://styles/mapbox/dark-v11"
              style={{ width: "100%", height: "100%" }}
            >
              <NavigationControl position="top-right" />

              {route && route.legs.map((leg, i) => {
                if (!leg.geometry?.coordinates?.length) return null;

                // First leg from user location to first waypoint
                if (hasMyLocationInRoute && i === 0) {
                  const to = routeWaypoints[0];
                  if (!to) return null;
                  return (
                    <Source
                      key="route-leg-my-location"
                      id="route-leg-my-location"
                      type="geojson"
                      data={{ type: "Feature", geometry: leg.geometry, properties: {} }}
                    >
                      <Layer
                        id="route-leg-line-my-location"
                        type="line"
                        paint={{
                          "line-color": "#3b82f6",
                          "line-width": 4,
                          "line-opacity": 0.85,
                          "line-dasharray": [2, 2],
                        }}
                      />
                    </Source>
                  );
                }

                const fromIdx = i - routeLegOffset;
                const toIdx = fromIdx + 1;
                const from = routeWaypoints[fromIdx];
                const to = routeWaypoints[toIdx];
                if (!from || !to) return null;

                const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;
                const departureMs = new Date(from.appointment.scheduled_at).getTime() + durationMinutes * 60000;
                const arrivalMs = departureMs + leg.duration * 1000;
                const nextAppointmentMs = new Date(to.appointment.scheduled_at).getTime();
                const bufferMinutes = Math.round((nextAppointmentMs - arrivalMs) / 60000);
                const color = getBufferColor(bufferMinutes);

                return (
                  <Source
                    key={`route-leg-${i}`}
                    id={`route-leg-${i}`}
                    type="geojson"
                    data={{ type: "Feature", geometry: leg.geometry, properties: {} }}
                  >
                    <Layer
                      id={`route-leg-line-${i}`}
                      type="line"
                      paint={{
                        "line-color": color,
                        "line-width": 4,
                        "line-opacity": 0.85,
                      }}
                    />
                  </Source>
                );
              })}

              {allWaypoints.map((w) => {
                const isSkipped = w.appointment.status === "skipped";
                const isOptional = w.appointment.status === "optional";
                const isRebook = w.appointment.status === "rebook";
                const isExcluded = isSkipped || isRebook || (isOptional && !includeOptional);
                const routeEntry = routeWaypoints.find((rw) => rw.appointment.id === w.appointment.id);
                return (
                  <Marker
                    key={w.appointment.id}
                    longitude={w.apartment.lng!}
                    latitude={w.apartment.lat!}
                    anchor="bottom"
                  >
                    <div className={`flex flex-col items-center ${isExcluded ? "opacity-40" : ""}`}>
                      <div className="bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded mb-1 whitespace-nowrap pointer-events-none">
                        {new Date(w.appointment.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {isSkipped || isRebook ? (
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted-foreground text-white text-xs font-bold border-2 border-white/50 shadow-lg">
                          {isRebook ? "↻" : "×"}
                        </div>
                      ) : isOptional ? (
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-warning text-warning-foreground text-xs font-bold border-2 border-white/70 shadow-lg">
                          {routeEntry != null ? routeEntry.index + 1 : "?"}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold border-2 border-white shadow-lg">
                          {routeEntry != null ? routeEntry.index + 1 : "?"}
                        </div>
                      )}
                    </div>
                  </Marker>
                );
              })}

              {myPosition && showMyLocation && (
                <Marker
                  longitude={myPosition.lng}
                  latitude={myPosition.lat}
                  anchor="center"
                >
                  <div className="flex flex-col items-center">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute w-8 h-8 rounded-full bg-primary/30 animate-ping" />
                      <div className="absolute w-6 h-6 rounded-full bg-primary/20" />
                      <div className="relative w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow-lg" />
                    </div>
                  </div>
                </Marker>
              )}

              {route && route.legs.map((leg, i) => {
                if (hasMyLocationInRoute && i === 0) {
                  if (!routeWaypoints[0] || !myPosition) return null;
                  const midLat = (myPosition.lat + routeWaypoints[0].apartment.lat!) / 2;
                  const midLng = (myPosition.lng + routeWaypoints[0].apartment.lng!) / 2;
                  return (
                    <Marker key="leg-my-loc" longitude={midLng} latitude={midLat} anchor="center">
                      <div className="bg-primary/90 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none">
                        {formatDuration(leg.duration)} · {formatDistance(leg.distance)}
                      </div>
                    </Marker>
                  );
                }
                const fromIdx = i - routeLegOffset;
                const toIdx = fromIdx + 1;
                const from = routeWaypoints[fromIdx];
                const to = routeWaypoints[toIdx];
                if (!from || !to) return null;
                const midLat = (from.apartment.lat! + to.apartment.lat!) / 2;
                const midLng = (from.apartment.lng! + to.apartment.lng!) / 2;
                return (
                  <Marker
                    key={`leg-${i}`}
                    longitude={midLng}
                    latitude={midLat}
                    anchor="center"
                  >
                    <div className="bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none">
                      {formatDuration(leg.duration)} · {formatDistance(leg.distance)}
                    </div>
                  </Marker>
                );
              })}
            </MapGL>
          </div>

          {route && (() => {
            const skippedCount = dayAppointments.filter((a) => a.status === "skipped").length;
            const optionalCount = dayAppointments.filter((a) => a.status === "optional").length;
            const firstLegInfo = hasMyLocationInRoute && route.legs[0]
              ? `${formatDuration(route.legs[0].duration)} to first stop`
              : null;
            return (
              <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur border border-border rounded-lg px-4 py-3 shadow-lg">
                <div className="text-sm font-semibold">
                  {routeWaypoints.length} viewing{routeWaypoints.length !== 1 ? "s" : ""}
                  {(skippedCount > 0 || optionalCount > 0) && (
                    <span className="text-muted-foreground font-normal ml-1.5">
                      ({[skippedCount > 0 && `${skippedCount} skipped`, optionalCount > 0 && `${optionalCount} optional`].filter(Boolean).join(", ")})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Total travel: {formatDuration(route.totalDuration)} · {formatDistance(route.totalDistance)}
                  <span className="ml-1.5 opacity-70">({profile})</span>
                </div>
                {firstLegInfo && (
                  <div className="text-xs text-primary mt-0.5">
                    📍 {firstLegInfo}
                  </div>
                )}
              </div>
            );
          })()}

          {routeWaypoints.length > 0 && !route && !loadingRoute && !routeError && (
            <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur border border-border rounded-lg px-4 py-3 shadow-lg">
              <div className="text-sm font-semibold">
                {routeWaypoints.length} viewing{routeWaypoints.length !== 1 ? "s" : ""}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Add more appointments to see route
              </div>
            </div>
          )}
        </div>
      )}

      {allWaypoints.length > 0 && (
        <div className="space-y-0">
          {dayAppointments.filter((a) => a.status === "optional").length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOptional}
                  onChange={(e) => setIncludeOptional(e.target.checked)}
                  className="rounded border-border"
                />
                Include optional in route
              </label>
            </div>
          )}
          {hasMyLocationInRoute && routeWaypoints.length > 0 && route?.legs[0] && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-primary border-l-2 border-primary/50 ml-3 mb-1">
              <span>📍</span>
              <span>From your location: {formatDuration(route.legs[0].duration)} · {formatDistance(route.legs[0].distance)} ({profile})</span>
            </div>
          )}
          {allWaypoints.map((w) => {
            const isSkipped = w.appointment.status === "skipped";
            const isOptional = w.appointment.status === "optional";
            const isRebook = w.appointment.status === "rebook";
            const isExcluded = isSkipped || isRebook || (isOptional && !includeOptional);
            const routeEntry = routeWaypoints.find((rw) => rw.appointment.id === w.appointment.id);
            const time = new Date(w.appointment.scheduled_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const agent = agents.find((a) => a.id === w.apartment.agent_id);

            const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;
            const endDate = new Date(new Date(w.appointment.scheduled_at).getTime() + durationMinutes * 60000);
            const endTime = endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            let transitLeg = null;

            if (!isExcluded && routeEntry != null) {
              const nextRouteIdx = routeEntry.index + 1;
              const nextRouteWaypoint = routeWaypoints.find((rw) => rw.index === nextRouteIdx);

              if (nextRouteWaypoint) {
                const legIdx = routeEntry.index + routeLegOffset;
                const hasAnyRoute = allRoutes.walking?.legs[legIdx] || allRoutes.cycling?.legs[legIdx] || allRoutes.driving?.legs[legIdx];

                if (hasAnyRoute) {
                  const departureTime = new Date(new Date(w.appointment.scheduled_at).getTime() + durationMinutes * 60000);
                  const nextAppointmentTime = new Date(nextRouteWaypoint.appointment.scheduled_at);

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
                } else {
                  transitLeg = <TransitLegNoRoute />;
                }
              }
            }

            return (
              <div key={w.appointment.id}>
                <div className="py-0.5">
                  <WaypointCard
                    index={routeEntry?.index ?? null}
                    time={time}
                    endTime={endTime}
                    apartment={w.apartment}
                    agent={agent ?? null}
                    isSkipped={isSkipped}
                    isOptional={isOptional}
                    isRebook={isRebook}
                    onStatusChange={async (newStatus) => {
                      patchAppointment(w.appointment.id, { status: newStatus });
                    }}
                    onNavigate={() => router.push(`/apartment/${w.apartment.id}`)}
                    onAgentChange={async (agentId) => {
                      patchApartment(w.apartment.id, { agent_id: agentId });
                    }}
                    comments={(latestComments[w.apartment.id] || []).map((c) => {
                      const p = memberProfiles[c.user_id];
                      return { content: c.content, avatar: p?.avatar ?? null, name: p?.name ?? p?.email ?? null };
                    })}
                    onAddComment={async (content) => {
                      if (!currentUserId || !group?.id) return;
                      writeComment({
                        id: crypto.randomUUID(),
                        group_id: group.id,
                        apartment_id: w.apartment.id,
                        user_id: currentUserId,
                        content,
                        created_at: null as unknown as string,
                        updated_at: null as unknown as string,
                        deleted: false,
                      });
                    }}
                  />
                </div>
                {transitLeg}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
