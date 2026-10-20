"use client";

import { useState } from "react";
import { fetchNearestPoiDistancesClient } from "@/lib/nearest-pois-client";

interface AptRow {
  id: string;
  lat: number;
  lng: number;
}

export default function BackfillPoisPage() {
  const [status, setStatus] = useState("idle");
  const [log, setLog] = useState<string[]>([]);

  const run = async () => {
    setStatus("running");
    setLog(["Fetching apartments needing backfill..."]);

    const res = await fetch("/api/poi-backfill");
    const { apartments }: { apartments: AptRow[] } = await res.json();
    setLog((l) => [...l, `Found ${apartments.length} apartments`]);

    if (apartments.length === 0) {
      setLog((l) => [...l, "Nothing to backfill!"]);
      setStatus("done");
      return;
    }

    const updates: { id: string; nearest_supermarket_m: number | null; nearest_transport_m: number | null }[] = [];

    for (let i = 0; i < apartments.length; i++) {
      const apt = apartments[i];
      setLog((l) => [...l, `[${i + 1}/${apartments.length}] Querying POIs for ${apt.id}...`]);
      const distances = await fetchNearestPoiDistancesClient(apt.lat, apt.lng);
      updates.push({ id: apt.id, ...distances });
      setLog((l) => [...l, `  → supermarket: ${distances.nearest_supermarket_m ?? "N/A"}m, transport: ${distances.nearest_transport_m ?? "N/A"}m`]);
      // Small delay between requests
      if (i < apartments.length - 1) await new Promise((r) => setTimeout(r, 1200));
    }

    setLog((l) => [...l, "Saving to database..."]);
    const saveRes = await fetch("/api/poi-backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const result = await saveRes.json();
    setLog((l) => [...l, `Done! Updated ${result.updated}/${result.total} apartments.`]);
    setStatus("done");
  };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Backfill POI Distances</h1>
      <button
        onClick={run}
        disabled={status === "running"}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
      >
        {status === "running" ? "Running..." : "Start Backfill"}
      </button>
      <pre className="mt-4 p-3 bg-muted rounded-md text-xs max-h-96 overflow-auto whitespace-pre-wrap">
        {log.join("\n") || "Click Start to begin."}
      </pre>
    </main>
  );
}
