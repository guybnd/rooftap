"use client";

import { useEffect, useRef, useState } from "react";
import type { NearbyPOI } from '@homeup/core';

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface UseNearbyPoisOptions {
  bbox: BBox | null;
  enabled?: boolean;
}

interface UseNearbyPoisResult {
  pois: NearbyPOI[];
  isLoading: boolean;
  error: string | null;
}

const poiCache = new Map<string, { pois: NearbyPOI[]; expires: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export function useNearbyPois({
  bbox,
  enabled = true,
}: UseNearbyPoisOptions): UseNearbyPoisResult {
  const [pois, setPois] = useState<NearbyPOI[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !bbox) {
      setPois([]);
      return;
    }

    const key = `${bbox.south.toFixed(3)},${bbox.west.toFixed(3)},${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`;

    const cached = poiCache.get(key);
    if (cached && cached.expires > Date.now()) {
      setPois(cached.pois);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      south: bbox.south.toFixed(5),
      west: bbox.west.toFixed(5),
      north: bbox.north.toFixed(5),
      east: bbox.east.toFixed(5),
    });

    fetch(`/api/nearby-pois?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`POI proxy returned ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const result: NearbyPOI[] = json.pois ?? [];
        poiCache.set(key, { pois: result, expires: Date.now() + CACHE_TTL });
        setPois(result);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message ?? "Failed to load nearby POIs");
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [bbox?.south, bbox?.west, bbox?.north, bbox?.east, enabled]);

  return { pois, isLoading, error };
}
