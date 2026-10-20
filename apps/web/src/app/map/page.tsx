"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { calculateScore, apartments$, appointments$, apartmentChecklistItems$, apartmentChecklistResponses$, useReconnectSync } from '@homeup/core';
import { MapViewLazy } from "@/components/map-view-lazy";
import { ItineraryMapLazy } from "@/components/itinerary-map-lazy";
import MapLoading from "./loading";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2 } from "lucide-react";
import type { Apartment, ApartmentWithScore, Appointment, ChecklistItem, ChecklistResponse } from '@homeup/core';

type MapTab = "all" | "itinerary";

export default function MapPageWrapper() {
  return (
    <Suspense fallback={<MapLoading />}>
      <MapPage />
    </Suspense>
  );
}

function MapPage() {
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date") || undefined;
  const { group, loading, refresh } = useDataCache();

  const apts$ = apartments$(group?.id);
  const appts$ = appointments$(group?.id);
  const checklistItemsStore$ = apartmentChecklistItems$(group?.id);
  const checklistResponsesStore$ = apartmentChecklistResponses$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(appts$);
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(checklistResponsesStore$);

  const rawApartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const appointments = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );
  const responses = use$(() =>
    Object.values(checklistResponsesStore$.get() ?? {}).filter((r): r is ChecklistResponse => !!r && !r.deleted)
  );

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

  const [tab, setTab] = useState<MapTab>("itinerary");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ updated: number; failed: number } | null>(null);

  const missingCoords = apartments.filter((a) => a.lat == null || a.lng == null).length;

  const hasFutureAppointments = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return appointments.some((a) => {
      const d = new Date(a.scheduled_at);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return a.status === "scheduled" && dateStr >= today;
    });
  }, [appointments]);

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/geocode-backfill", { method: "POST" });
      const data = await res.json();
      setBackfillResult({ updated: data.updated, failed: data.failed });
      if (data.updated > 0) await refresh();
    } finally {
      setBackfilling(false);
    }
  };

  if (loading) return <MapLoading />;

  return (
    <main className="p-4 sm:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Map View</h1>
          <p className="text-muted-foreground mt-1">
            {tab === "all"
              ? "Your apartments displayed on a map with score-colored markers"
              : "Daily viewing itinerary with route and travel times"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {missingCoords > 0 && tab === "all" && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackfill}
                disabled={backfilling}
              >
                {backfilling ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <MapPin className="h-4 w-4 mr-1.5" />
                )}
                {backfilling ? "Geocoding..." : `Geocode ${missingCoords} missing`}
              </Button>
              {backfillResult && (
                <p className="text-xs text-muted-foreground">
                  {backfillResult.updated} located
                  {backfillResult.failed > 0 ? `, ${backfillResult.failed} failed` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {hasFutureAppointments && (
        <div className="flex rounded-lg border border-border overflow-hidden mb-4 w-fit">
          <button
            onClick={() => setTab("all")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted text-muted-foreground"
            }`}
          >
            All Apartments
          </button>
          <button
            onClick={() => setTab("itinerary")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === "itinerary"
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted text-muted-foreground"
            }`}
          >
            Daily Itinerary
          </button>
        </div>
      )}

      {tab === "all" ? (
        <MapViewLazy apartments={apartments} />
      ) : (
        <ItineraryMapLazy initialDate={dateParam} />
      )}
    </main>
  );
}
