"use client";

import dynamic from "next/dynamic";

const ApartmentDetailMap = dynamic(
  () => import("@/components/apartment-detail-map").then((m) => m.ApartmentDetailMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground text-sm">
        Loading map…
      </div>
    ),
  }
);

export function ApartmentDetailMapLazy({ lat, lng }: { lat: number; lng: number }) {
  return <ApartmentDetailMap lat={lat} lng={lng} />;
}
