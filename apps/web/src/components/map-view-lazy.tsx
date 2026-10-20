"use client";

import dynamic from "next/dynamic";
import type { ApartmentWithScore } from '@homeup/core';

const MapView = dynamic(() => import("@/components/map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
      Loading map...
    </div>
  ),
});

export function MapViewLazy({ apartments }: { apartments: ApartmentWithScore[] }) {
  return <MapView apartments={apartments} />;
}
