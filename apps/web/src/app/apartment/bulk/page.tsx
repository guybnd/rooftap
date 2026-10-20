"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Square, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { createClient } from "@/lib/supabase/client";
import { geocodeAddress } from "@/lib/geocode";
import { fetchNearestPoiDistancesClient } from "@/lib/nearest-pois-client";
import { useDataCache } from "@/lib/data-cache";
import { apartments$, agents$, apartmentAgents$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import type { Agent } from '@homeup/core';
import { Button } from "@/components/ui/button";
import { useBulkUploadSession } from "@/hooks/use-bulk-upload-session";

type UrlStatus = "queued" | "parsing" | "saving" | "done" | "failed";

interface UrlEntry {
  url: string;
  status: UrlStatus;
  address?: string;
  thumbnail?: string;
  apartmentId?: string;
  error?: string;
}

export default function BulkUploadPage() {
  const { group, currentUserId } = useDataCache();
  const agentsStore$ = agents$(group?.id);
  const apts$ = apartments$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  useReconnectSync(agentsStore$);
  useReconnectSync(apts$);
  useReconnectSync(apartmentAgentsStore$);
  const { writeRow: writeAgent } = useStoreHelpers(agentsStore$, currentUserId);
  const { writeRow: writeApartment, patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeApartmentAgent } = useStoreHelpers(apartmentAgentsStore$, currentUserId);
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const [urls, setUrls] = useState("");
  const { entries, setEntries, restored, startSession, completeSession, clearSession } = useBulkUploadSession();
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const updateEntry = useCallback((index: number, patch: Partial<UrlEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, [setEntries]);

  const processUrls = async () => {
    const lines = urls
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l.startsWith("http"));

    if (!lines.length) return;

    if (!group) return;

    const initial: UrlEntry[] = lines.map((url) => ({ url, status: "queued" }));
    startSession(initial);
    setRunning(true);
    stopRef.current = false;

    for (let i = 0; i < initial.length; i++) {
      if (stopRef.current) break;

      setEntries((prev) =>
        prev.map((e, idx) => (idx === i ? { ...e, status: "parsing" } : e))
      );

      try {
        const res = await fetch("/api/parse-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: initial[i].url }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          updateEntry(i, { status: "failed", error: data.error || `HTTP ${res.status}` });
          continue;
        }

        const data = await res.json();

        if (!data.address) {
          updateEntry(i, { status: "failed", error: "No address extracted" });
          continue;
        }

        updateEntry(i, {
          status: "saving",
          address: data.address,
          thumbnail: data.image_urls?.[0] || undefined,
        });

        if (stopRef.current) break;

        const parsedAgents: Array<{ name: string; phone?: string }> = data.agents?.length
          ? data.agents
          : data.agent_name
            ? [{ name: data.agent_name, phone: data.agent_phone }]
            : [];

        const resolvedAgentIds: string[] = [];
        const colors = ["#ef4444","#f97316","#f59e0b","#84cc16","#22c55e","#06b6d4","#3b82f6","#6366f1","#a855f7","#ec4899"];

        for (const pa of parsedAgents) {
          const match = agents.find(
            (a) => a.name.toLowerCase() === pa.name.toLowerCase()
          );
          if (match) {
            resolvedAgentIds.push(match.id);
          } else {
            const used = new Set(agents.map((a) => a.color));
            const available = colors.filter((c) => !used.has(c));
            const pool = available.length > 0 ? available : colors;
            const color = pool[Math.floor(Math.random() * pool.length)];
            const newAgentId = crypto.randomUUID();
            writeAgent({
              id: newAgentId,
              user_id: currentUserId ?? "",
              group_id: group.id,
              name: pa.name,
              phone: pa.phone || null,
              color,
              notes: null,
              deleted: false,
              created_at: null as unknown as string,
              updated_at: null as unknown as string,
            });
            resolvedAgentIds.push(newAgentId);
          }
        }

        const apartmentId = crypto.randomUUID();
        writeApartment({
          id: apartmentId,
          user_id: currentUserId ?? "",
          group_id: group.id,
          address: data.address,
          suburb: data.suburb || null,
          rent_per_week: data.rent_per_week ? Number(data.rent_per_week) : null,
          bedrooms: data.bedrooms ? Number(data.bedrooms) : null,
          bathrooms: data.bathrooms ? Number(data.bathrooms) : null,
          parking: data.parking ?? false,
          listing_url: initial[i].url,
          notes: data.notes || null,
          lat: null,
          lng: null,
          agent_id: resolvedAgentIds[0] ?? null,
          preliminary_score: null,
          nearest_supermarket_m: null,
          nearest_transport_m: null,
          disposition: null,
          move_in_date: null,
          main_location: null,
          archived: false,
          deleted: false,
          created_at: null as unknown as string,
          updated_at: null as unknown as string,
        });

        if (resolvedAgentIds.length > 0) {
          for (const agent_id of resolvedAgentIds) {
            writeApartmentAgent({
              id: crypto.randomUUID(),
              group_id: group.id,
              apartment_id: apartmentId,
              agent_id,
              deleted: false,
              created_at: null as unknown as string,
              updated_at: null as unknown as string,
            });
          }
        }

        const coords = await geocodeAddress(data.address, data.suburb || null);
        if (coords) {
          patchApartment(apartmentId, { lat: coords.lat, lng: coords.lng });
          fetchNearestPoiDistancesClient(coords.lat, coords.lng).then((distances) => {
            if (distances.nearest_supermarket_m != null || distances.nearest_transport_m != null) {
              patchApartment(apartmentId, distances);
            }
          });
        }

        if (data.image_urls?.length) {
          const supabase = createClient();
          const photoRows = data.image_urls.map((imageUrl: string, idx: number) => ({
            apartment_id: apartmentId,
            storage_path: imageUrl,
            caption: "listing",
            is_main: idx === 0,
          }));
          await supabase.from("photos").insert(photoRows);
        }

        updateEntry(i, { status: "done", apartmentId });
      } catch (err) {
        updateEntry(i, {
          status: "failed",
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    }

    setRunning(false);
    completeSession();
  };

  const stop = () => {
    stopRef.current = true;
  };

  const doneCount = entries.filter((e) => e.status === "done").length;
  const failedCount = entries.filter((e) => e.status === "failed").length;

  // Hearth v2 pass: Display-step title, sentence-case verbs, URLs in the body
  // face (T3: mono is for time/count fragments), the queue as one rounded-3xl
  // card of divided rows (H4) rather than a stack of bordered boxes, and one
  // status line of fragments ("Processing 3 of 10", "2 saved · 1 failed").
  const resetSession = () => {
    clearSession();
    setUrls("");
  };

  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto">
      <Link
        href="/apartment/new"
        className="-ml-2 mb-4 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <h1 className="mb-1 font-heading text-2xl font-bold tracking-[-0.02em]">Bulk upload</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        One listing URL per line, each saved as an apartment
      </p>

      {!entries.length && (
        <div className="space-y-4">
          <textarea
            placeholder={"https://www.domain.com.au/...\nhttps://www.realestate.com.au/..."}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={8}
            className="w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            onClick={processUrls}
            disabled={!urls.trim()}
            className="h-11 w-full rounded-xl sm:w-auto sm:px-5"
          >
            <Play className="h-4 w-4 mr-1.5" />
            Start processing
          </Button>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm tabular-nums text-muted-foreground">
              {running ? (
                `Processing ${doneCount + failedCount} of ${entries.length}`
              ) : (
                <>
                  {restored && "Last session: "}
                  <span className="text-foreground">{doneCount} saved</span>
                  {failedCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-destructive">{failedCount} failed</span>
                    </>
                  )}
                </>
              )}
            </p>
            {running ? (
              <Button variant="outline" className="h-9 rounded-lg" onClick={stop}>
                <Square className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                Stop
              </Button>
            ) : (
              <Button variant="outline" className="h-9 rounded-lg" onClick={resetSession}>
                Start over
              </Button>
            )}
          </div>

          <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
            {entries.map((entry, i) => {
              const row = (
                <>
                  <StatusIcon status={entry.status} />
                  <div className="min-w-0 flex-1">
                    {entry.address ? (
                      <p className="truncate text-sm font-medium">{entry.address}</p>
                    ) : (
                      <p className="truncate text-sm text-muted-foreground">{entry.url}</p>
                    )}
                    {entry.error && (
                      <p className="mt-0.5 text-xs text-destructive">{entry.error}</p>
                    )}
                  </div>
                  {entry.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.thumbnail}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  {entry.apartmentId && <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </>
              );
              return entry.apartmentId ? (
                <Link
                  key={i}
                  href={`/apartment/${entry.apartmentId}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                >
                  {row}
                </Link>
              ) : (
                <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                  {row}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

function StatusIcon({ status }: { status: UrlStatus }) {
  switch (status) {
    case "queued":
      return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0" aria-label="Queued" />;
    case "parsing":
    case "saving":
      return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" aria-label="Processing" />;
    case "done":
      return <CheckCircle2 className="h-5 w-5 text-success shrink-0" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-destructive shrink-0" />;
  }
}
