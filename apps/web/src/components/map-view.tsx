"use client";

import { useCallback, useMemo, useState } from "react";
import MapGL, { Marker, Popup, NavigationControl } from "react-map-gl/mapbox";
import { useRouter } from "next/navigation";
import { MapPinOffIcon } from "lucide-react";
import type { ApartmentWithScore, NearbyPOI, POICategory } from '@homeup/core';
import { useNearbyPois } from "@/hooks/use-nearby-pois";
import { useDataCache } from "@/lib/data-cache";
import "mapbox-gl/dist/mapbox-gl.css";
import { currencySymbol } from "@homeup/core";

interface MapViewProps {
  apartments: ApartmentWithScore[];
}

function getMarkerColor(apartment: ApartmentWithScore): string {
  if (!apartment.score) return "#6b7280";
  if (apartment.score.dealbreakers.length > 0) return "#f87171";
  if (apartment.score.percentage >= 80) return "#34d399";
  if (apartment.score.percentage >= 60) return "#fbbf24";
  return "#f87171";
}

const POI_CONFIG: Record<POICategory, { emoji: string; label: string; color: string }> = {
  supermarket: { emoji: "🛒", label: "Supermarkets", color: "#16a34a" },
  bus_stop: { emoji: "🚌", label: "Bus Stops", color: "#2563eb" },
  tram_stop: { emoji: "🚊", label: "Tram Stops", color: "#7c3aed" },
  train_station: { emoji: "🚆", label: "Train Stations", color: "#dc2626" },
};

export function MapView({ apartments }: MapViewProps) {
  const router = useRouter();
  const { isOnline } = useDataCache();
  const [popupApt, setPopupApt] = useState<ApartmentWithScore | null>(null);
  const [popupPoi, setPopupPoi] = useState<NearbyPOI | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Record<POICategory, boolean>>({
    supermarket: true,
    bus_stop: true,
    tram_stop: true,
    train_station: true,
  });

  const mappable = useMemo(
    () => apartments.filter((a) => a.lat != null && a.lng != null),
    [apartments]
  );

  const initialViewState = useMemo(() => {
    if (mappable.length === 0) {
      return { longitude: 151.2093, latitude: -33.8688, zoom: 11 };
    }
    const lats = mappable.map((a) => a.lat!);
    const lngs = mappable.map((a) => a.lng!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latSpread = maxLat - minLat;
    const lngSpread = maxLng - minLng;
    const spread = Math.max(latSpread, lngSpread, 0.005);
    const zoom = Math.min(14, Math.max(9, Math.floor(Math.log2(360 / spread) - 1)));
    return { longitude: centerLng, latitude: centerLat, zoom };
  }, [mappable]);

  // Compute bounding box covering all apartments + 500m padding
  const poiBBox = useMemo(() => {
    if (mappable.length === 0) return null;
    const lats = mappable.map((a) => a.lat!);
    const lngs = mappable.map((a) => a.lng!);
    const pad = 0.005; // ~500m
    return {
      south: Math.min(...lats) - pad,
      west: Math.min(...lngs) - pad,
      north: Math.max(...lats) + pad,
      east: Math.max(...lngs) + pad,
    };
  }, [mappable]);

  const { pois, isLoading: poisLoading } = useNearbyPois({
    bbox: poiBBox,
    enabled: mappable.length > 0,
  });

  const filteredPois = useMemo(
    () => pois.filter((poi) => visibleLayers[poi.category]),
    [pois, visibleLayers]
  );

  // Per-apartment nearest POI distances
  const aptNearestPois = useMemo(() => {
    if (pois.length === 0) return new Map<string, { supermarket?: number; transport?: number }>();
    const result = new Map<string, { supermarket?: number; transport?: number }>();
    for (const apt of mappable) {
      let nearestSuper = Infinity;
      let nearestTransport = Infinity;
      for (const poi of pois) {
        const dLat = ((poi.lat - apt.lat!) * Math.PI) / 180;
        const dLng = ((poi.lng - apt.lng!) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((apt.lat! * Math.PI) / 180) *
            Math.cos((poi.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (poi.category === "supermarket") {
          nearestSuper = Math.min(nearestSuper, dist);
        } else {
          nearestTransport = Math.min(nearestTransport, dist);
        }
      }
      result.set(apt.id, {
        supermarket: nearestSuper === Infinity ? undefined : Math.round(nearestSuper),
        transport: nearestTransport === Infinity ? undefined : Math.round(nearestTransport),
      });
    }
    return result;
  }, [pois, mappable]);

  const toggleLayer = useCallback((category: POICategory) => {
    setVisibleLayers((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  const handleMarkerClick = useCallback(
    (apt: ApartmentWithScore) => {
      setPopupPoi(null);
      setPopupApt(apt);
    },
    []
  );

  const handleMapClick = useCallback(() => {
    setPopupApt(null);
    setPopupPoi(null);
  }, []);

  const handlePopupNavigate = useCallback(
    (id: string) => {
      router.push(`/apartment/${id}`);
    },
    [router]
  );

  if (!isOnline) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
        <MapPinOffIcon className="h-6 w-6" />
        Map unavailable offline
      </div>
    );
  }

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
        Mapbox token not configured. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local
      </div>
    );
  }

  if (mappable.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] rounded-xl border border-border bg-card text-muted-foreground text-sm">
        No apartments with location data to display on map.
      </div>
    );
  }

  return (
    <div className="relative h-[500px] sm:h-[600px] rounded-xl overflow-hidden border border-border">
      {/* POI Layer Toggles */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        {(Object.entries(POI_CONFIG) as [POICategory, typeof POI_CONFIG[POICategory]][]).map(
          ([cat, { emoji, label, color }]) => (
            <button
              key={cat}
              onClick={() => toggleLayer(cat)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium shadow-md transition-colors ${
                visibleLayers[cat]
                  ? "text-white"
                  : "bg-white/90 text-gray-600 hover:bg-white"
              }`}
              style={visibleLayers[cat] ? { backgroundColor: color } : undefined}
            >
              <span>{emoji}</span>
              <span>{label}</span>
            </button>
          )
        )}
        {poisLoading && (
          <span className="text-[10px] text-muted-foreground px-1">Loading POIs…</span>
        )}
      </div>

      <MapGL
        initialViewState={initialViewState}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: "100%", height: "100%" }}
        onClick={handleMapClick}
      >
        <NavigationControl position="top-right" />

        {mappable.map((apt) => (
          <Marker
            key={apt.id}
            longitude={apt.lng!}
            latitude={apt.lat!}
            anchor="center"
            onClick={(e: { originalEvent: MouseEvent }) => {
              e.originalEvent.stopPropagation();
              handleMarkerClick(apt);
            }}
          >
            <div className="relative flex items-center justify-center cursor-pointer hover:scale-110 transition-transform">
              <div
                className="absolute w-7 h-7 rounded-full opacity-30"
                style={{ backgroundColor: getMarkerColor(apt) }}
              />
              <div
                className="relative w-5 h-5 rounded-full border-[2.5px] border-white shadow-lg"
                style={{ backgroundColor: getMarkerColor(apt) }}
              />
            </div>
          </Marker>
        ))}

        {/* POI Markers */}
        {filteredPois.map((poi) => {
          const cfg = POI_CONFIG[poi.category];
          return (
            <Marker
              key={`poi-${poi.id}`}
              longitude={poi.lng}
              latitude={poi.lat}
              anchor="center"
              onClick={(e: { originalEvent: MouseEvent }) => {
                e.originalEvent.stopPropagation();
                setPopupApt(null);
                setPopupPoi(poi);
              }}
            >
              <div
                className="w-4 h-4 flex items-center justify-center rounded-full shadow-sm cursor-pointer hover:scale-125 transition-transform text-[8px]"
                style={{
                  backgroundColor: cfg.color,
                  border: "1px solid rgba(255,255,255,0.6)",
                }}
              >
                {cfg.emoji}
              </div>
            </Marker>
          );
        })}

        {popupApt && popupApt.lat && popupApt.lng && (
          <Popup
            longitude={popupApt.lng}
            latitude={popupApt.lat}
            anchor="bottom"
            onClose={() => setPopupApt(null)}
            closeOnClick={false}
            className="map-popup"
          >
            <div
              className="p-2 min-w-[180px] cursor-pointer"
              onClick={() => handlePopupNavigate(popupApt.id)}
            >
              <p className="font-semibold text-sm text-gray-900 truncate">
                {popupApt.address}
              </p>
              {popupApt.suburb && (
                <p className="text-xs text-gray-500">{popupApt.suburb}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-600">
                {popupApt.rent_per_week != null && (
                  <span>{currencySymbol()}{popupApt.rent_per_week}/wk</span>
                )}
                {popupApt.score && (
                  <span
                    className="font-semibold"
                    style={{ color: getMarkerColor(popupApt) }}
                  >
                    {popupApt.score.dealbreakers.length > 0
                      ? "Fail"
                      : `${popupApt.score.percentage}%`}
                  </span>
                )}
              </div>
              {aptNearestPois.get(popupApt.id) && (
                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                  {aptNearestPois.get(popupApt.id)!.supermarket != null && (
                    <span>🛒 ~{aptNearestPois.get(popupApt.id)!.supermarket}m</span>
                  )}
                  {aptNearestPois.get(popupApt.id)!.transport != null && (
                    <span>🚉 ~{aptNearestPois.get(popupApt.id)!.transport}m</span>
                  )}
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-1">Click to view details</p>
            </div>
          </Popup>
        )}

        {popupPoi && (
          <Popup
            longitude={popupPoi.lng}
            latitude={popupPoi.lat}
            anchor="bottom"
            onClose={() => setPopupPoi(null)}
            closeOnClick={false}
            className="map-popup"
          >
            <div className="p-2 min-w-[140px]">
              <p className="font-semibold text-sm text-gray-900">
                {POI_CONFIG[popupPoi.category].emoji}{" "}
                {popupPoi.name ?? POI_CONFIG[popupPoi.category].label.replace(/s$/, "")}
              </p>
              {popupPoi.distance != null && (
                <p className="text-xs text-gray-500 mt-0.5">~{popupPoi.distance}m walk</p>
              )}
            </div>
          </Popup>
        )}
      </MapGL>
    </div>
  );
}
