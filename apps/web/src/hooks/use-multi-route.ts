"use client";

import { useCallback, useEffect, useState } from "react";

type TravelProfile = "walking" | "cycling" | "driving";

interface RouteLeg {
  duration: number;
  distance: number;
  geometry: GeoJSON.LineString;
}

interface RouteData {
  geometry: GeoJSON.LineString;
  legs: RouteLeg[];
  totalDuration: number;
  totalDistance: number;
}

type AllRoutes = Record<TravelProfile, RouteData | null>;

interface Waypoint {
  lng: number;
  lat: number;
}

interface UseMultiRouteResult {
  allRoutes: AllRoutes;
  loading: boolean;
  error: string | null;
}

export type { TravelProfile, RouteLeg, RouteData, AllRoutes, Waypoint };

export function useMultiRoute(waypoints: Waypoint[]): UseMultiRouteResult {
  const [allRoutes, setAllRoutes] = useState<AllRoutes>({ walking: null, cycling: null, driving: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coordsKey = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");

  const fetchRoutes = useCallback(async () => {
    if (waypoints.length < 2) {
      setAllRoutes({ walking: null, cycling: null, driving: null });
      return;
    }

    setLoading(true);
    setError(null);

    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const profiles: TravelProfile[] = ["walking", "cycling", "driving"];

    try {
      const results = await Promise.all(
        profiles.map(async (p) => {
          const res = await fetch(`/api/directions?coordinates=${coords}&profile=${p}`);
          if (!res.ok) return null;
          return (await res.json()) as RouteData;
        })
      );
      setAllRoutes({
        walking: results[0],
        cycling: results[1],
        driving: results[2],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch routes");
      setAllRoutes({ walking: null, cycling: null, driving: null });
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsKey]);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  return { allRoutes, loading, error };
}
