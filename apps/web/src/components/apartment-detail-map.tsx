"use client";

import { useMemo } from "react";
import MapGL, { Marker, NavigationControl } from "react-map-gl/mapbox";
import type { NearbyPOI, POICategory } from '@homeup/core';
import { useNearbyPois } from "@/hooks/use-nearby-pois";
import "mapbox-gl/dist/mapbox-gl.css";

interface ApartmentDetailMapProps {
  lat: number;
  lng: number;
}

const POI_CONFIG: Record<POICategory, { emoji: string; label: string; color: string }> = {
  supermarket: { emoji: "🛒", label: "Supermarket", color: "var(--success)" },
  bus_stop: { emoji: "🚌", label: "Bus Stop", color: "var(--primary)" },
  tram_stop: { emoji: "🚊", label: "Tram Stop", color: "var(--muted-foreground)" },
  train_station: { emoji: "🚆", label: "Train Station", color: "var(--destructive)" },
};

function ApartmentDetailMapInner({ lat, lng }: ApartmentDetailMapProps) {
  const pad = 0.005; // ~500m
  const bbox = useMemo(
    () => ({
      south: lat - pad,
      west: lng - pad,
      north: lat + pad,
      east: lng + pad,
    }),
    [lat, lng]
  );

  const { pois, isLoading } = useNearbyPois({ bbox, enabled: true });

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-border h-[300px] relative">
      {isLoading && (
        <div className="absolute top-2 left-2 z-10 text-[10px] bg-white/90 text-muted-foreground px-2 py-0.5 rounded shadow-sm">
          Loading POIs…
        </div>
      )}
      <MapGL
        initialViewState={{ longitude: lng, latitude: lat, zoom: 15 }}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />

        {/* Apartment marker */}
        <Marker longitude={lng} latitude={lat} anchor="center">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-8 h-8 rounded-full bg-primary opacity-25 animate-ping" />
            <div className="relative w-5 h-5 rounded-full border-[2.5px] border-white shadow-lg bg-primary" />
          </div>
        </Marker>

        {/* POI markers */}
        {pois.map((poi: NearbyPOI) => {
          const cfg = POI_CONFIG[poi.category];
          return (
            <Marker key={poi.id} longitude={poi.lng} latitude={poi.lat} anchor="center">
              <div
                className="w-5 h-5 flex items-center justify-center rounded-full shadow-sm text-[10px]"
                style={{ backgroundColor: cfg.color, border: "1.5px solid rgba(255,255,255,0.7)" }}
                title={poi.name ?? cfg.label}
              >
                {cfg.emoji}
              </div>
            </Marker>
          );
        })}
      </MapGL>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 flex gap-2">
        {(["supermarket", "train_station", "bus_stop", "tram_stop"] as POICategory[]).map((cat) => {
          const count = pois.filter((p: NearbyPOI) => p.category === cat).length;
          if (count === 0) return null;
          const cfg = POI_CONFIG[cat];
          return (
            <span
              key={cat}
              className="flex items-center gap-1 bg-white/90 text-muted-foreground text-[10px] px-1.5 py-0.5 rounded shadow-sm"
            >
              {cfg.emoji} {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export { ApartmentDetailMapInner as ApartmentDetailMap };
