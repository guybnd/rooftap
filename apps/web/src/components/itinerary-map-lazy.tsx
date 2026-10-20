"use client";

import dynamic from "next/dynamic";

const ItineraryMap = dynamic(
  () => import("@/components/itinerary-map").then((m) => m.ItineraryMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
        Loading itinerary map...
      </div>
    ),
  }
);

export function ItineraryMapLazy({ initialDate }: { initialDate?: string }) {
  return <ItineraryMap initialDate={initialDate} />;
}
