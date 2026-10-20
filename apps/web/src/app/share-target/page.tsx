"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, AlertCircle, Calendar } from "lucide-react";
import imageCompression from "browser-image-compression";
import { use$ } from "@legendapp/state/react";
import { createClient } from "@/lib/supabase/client";
import { geocodeAddress } from "@/lib/geocode";
import { renderPdfToImages } from "@/lib/pdf-utils";
import { useDataCache } from "@/lib/data-cache";
import { parseIcs, type ParsedEvent, apartments$, agents$, appointments$, getEnabledModules, isFeatureEnabled, syncedGroupId, useModules, useReconnectSync, useStoreHelpers } from '@homeup/core';
import type { Agent, Apartment } from '@homeup/core';
import { ApartmentPicker, fuzzyMatchApartment } from "@/components/apartment-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentSelector } from "@/components/agent-selector";
import { ShareDestinationPicker } from "@/components/share-destination-picker";

type Status = "picking-destination" | "loading" | "parsing" | "confirm" | "confirm-calendar" | "saving" | "done" | "error" | "unavailable";

export default function ShareTargetPage() {
  return (
    <Suspense fallback={
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground">Loading...</p>
      </main>
    }>
      <ShareTargetContent />
    </Suspense>
  );
}

function ShareTargetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { group, loading: dataLoading, refresh: refreshCache, currentUserId } = useDataCache();
  const modules = useModules();

  // Home Search's stores; with it off they open with no group id and don't sync (store-modules.ts).
  const apts$ = apartments$(syncedGroupId(apartments$, group?.id, modules.enabled));
  const agentsStore$ = agents$(syncedGroupId(agents$, group?.id, modules.enabled));
  const appts$ = appointments$(syncedGroupId(appointments$, group?.id, modules.enabled));
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(appts$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const { writeRow: writeAppointment } = useStoreHelpers(appts$, currentUserId);

  // Modules: a shared .ics imports a viewing (capture.calendar-file) and any
  // other file parses a listing (capture.listing); both need search. With
  // neither on, there's nothing to pick (module-features.ts).
  const listingOn = modules.feature("capture.listing");
  const canTakeShares = listingOn || modules.feature("capture.calendar-file");

  const [status, setStatus] = useState<Status>("picking-destination");
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [parsedImages, setParsedImages] = useState<string[]>([]);
  const [calendarEvent, setCalendarEvent] = useState<ParsedEvent | null>(null);
  const [calendarApartmentId, setCalendarApartmentId] = useState<string | null>(null);
  const [calendarSuggestedId, setCalendarSuggestedId] = useState<string | null>(null);
  const [calendarNotes, setCalendarNotes] = useState("");
  const [form, setForm] = useState({
    address: "",
    suburb: "",
    rent_per_week: "",
    bedrooms: "",
    bathrooms: "",
    parking: false,
    notes: "",
  });

  useEffect(() => {
    if (searchParams.get("error") === "no-file") {
      setStatus("error");
      setError("No file was shared. Please try again.");
      return;
    }
    if (selectedSection && !dataLoading && group) {
      setStatus("loading");
      processSharedFile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, dataLoading, group]);

  function handleDestinationSelected(sectionId: string) {
    setSelectedSection(sectionId);
  }

  async function processSharedFile() {
    try {
      const cache = await caches.open("share-target-files");
      const response = await cache.match("/share-target-file");
      if (!response) {
        setStatus("error");
        setError("No shared file found. Please share again.");
        return;
      }

      const contentType = response.headers.get("Content-Type") || "";
      const fileName = response.headers.get("X-File-Name") || "shared-file";
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: contentType });

      await cache.delete("/share-target-file");

      const isIcs = contentType === "text/calendar" || fileName.endsWith(".ics");
      if (!isFeatureEnabled(isIcs ? "capture.calendar-file" : "capture.listing", getEnabledModules())) {
        setStatus("unavailable");
        return;
      }

      setStatus("parsing");

      if (isIcs) {
        const text = await blob.text();
        const event = parseIcs(text);
        if (!event) {
          setStatus("error");
          setError("Could not parse calendar file. Only single-event .ics files are supported.");
          return;
        }
        setCalendarEvent(event);
        setCalendarNotes(event.description);
        const match = fuzzyMatchApartment(event.location, apartments);
        if (match) {
          setCalendarApartmentId(match);
          setCalendarSuggestedId(match);
        }
        setStatus("confirm-calendar");
        return;
      }

      let images: string[];
      if (contentType === "application/pdf") {
        images = await renderPdfToImages(file);
      } else {
        const compressed = await imageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(compressed);
        });
        images = [dataUrl];
      }

      const res = await fetch("/api/parse-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMsg = "Failed to parse listing";
        try { errorMsg = JSON.parse(text).error || errorMsg; } catch { errorMsg = text || errorMsg; }
        setStatus("error");
        setError(errorMsg);
        return;
      }
      const data = await res.json();

      setForm({
        address: data.address || "",
        suburb: data.suburb || "",
        rent_per_week: data.rent_per_week ? String(data.rent_per_week) : "",
        bedrooms: data.bedrooms ? String(data.bedrooms) : "",
        bathrooms: data.bathrooms ? String(data.bathrooms) : "",
        parking: data.parking ?? false,
        notes: data.notes || "",
      });

      if (data.image_urls?.length) {
        setParsedImages(data.image_urls);
      }

      if (data.agent_name) {
        const match = agents.find(
          (a) => a.name.toLowerCase() === data.agent_name.toLowerCase()
        );
        if (match) {
          setAgentId(match.id);
        } else {
          const supabase = createClient();
          const colors = ["#ef4444","#f97316","#f59e0b","#84cc16","#22c55e","#06b6d4","#3b82f6","#6366f1","#a855f7","#ec4899"];
          const used = new Set(agents.map((a) => a.color));
          const available = colors.filter((c) => !used.has(c));
          const pool = available.length > 0 ? available : colors;
          const color = pool[Math.floor(Math.random() * pool.length)];
          const { data: newAgent } = await supabase
            .from("agents")
            .insert({ name: data.agent_name, phone: data.agent_phone || null, color, group_id: group!.id })
            .select()
            .single();
          if (newAgent) {
            setAgentId(newAgent.id);
            refreshCache();
          }
        }
      }

      setStatus("confirm");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function handleSave() {
    if (!form.address.trim()) return;
    setStatus("saving");

    try {
      const supabase = createClient();
      const { data, error: insertErr } = await supabase
        .from("apartments")
        .insert({
          address: form.address.trim(),
          suburb: form.suburb.trim() || null,
          rent_per_week: form.rent_per_week ? Number(form.rent_per_week) : null,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
          bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
          parking: form.parking,
          notes: form.notes.trim() || null,
          agent_id: agentId,
          group_id: group!.id,
        })
        .select()
        .single();

      if (insertErr) {
        setStatus("error");
        setError(insertErr.message);
        return;
      }

      const coords = await geocodeAddress(form.address.trim(), form.suburb.trim() || null);
      if (coords) {
        await supabase.from("apartments").update({ lat: coords.lat, lng: coords.lng }).eq("id", data.id);
      }

      if (parsedImages.length) {
        const photoRows = parsedImages.map((url, i) => ({
          apartment_id: data.id,
          storage_path: url,
          caption: "listing",
          is_main: i === 0,
        }));
        await supabase.from("photos").insert(photoRows);
      }

      setStatus("done");
      setTimeout(() => router.push(`/apartment/${data.id}`), 1500);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function handleSaveCalendar() {
    if (!calendarEvent?.dtstart || !calendarApartmentId || !currentUserId || !group?.id) return;
    setStatus("saving");

    try {
      writeAppointment({
        id: crypto.randomUUID(),
        user_id: currentUserId,
        group_id: group.id,
        apartment_id: calendarApartmentId,
        scheduled_at: calendarEvent.dtstart.toISOString(),
        notes: calendarNotes.trim() || null,
        status: "scheduled",
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });

      setStatus("done");
      setTimeout(() => router.push("/appointments"), 1500);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed to save appointment");
    }
  }

  if (status === "unavailable" || (status === "picking-destination" && !canTakeShares)) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">Nothing in Rooftap can take this yet.</p>
        <Button onClick={() => router.push("/home")}>Go to Home</Button>
      </main>
    );
  }

  if (status === "picking-destination") {
    return <ShareDestinationPicker onSelect={handleDestinationSelected} />;
  }

  if (status === "loading" || status === "parsing") {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          {status === "loading" ? "Loading shared file..." : "Parsing listing..."}
        </p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-lg text-destructive">{error}</p>
        {listingOn ? (
          <Button onClick={() => router.push("/homesearch")}>Go to Home Search</Button>
        ) : (
          <Button onClick={() => router.push("/home")}>Go to Home</Button>
        )}
      </main>
    );
  }

  if (status === "saving") {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          {calendarEvent ? "Saving appointment..." : "Saving apartment..."}
        </p>
      </main>
    );
  }

  if (status === "done") {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <CheckCircle className="h-10 w-10 text-success" />
        <p className="text-lg">{calendarEvent ? "Appointment saved!" : "Apartment saved!"}</p>
      </main>
    );
  }

  if (status === "confirm-calendar" && calendarEvent) {
    return (
      <main className="p-4 sm:p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Import Calendar Event</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Review the event and link it to an apartment.
        </p>

        <div className="space-y-4">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{calendarEvent.summary || "Untitled event"}</span>
            </div>
            {calendarEvent.dtstart && (
              <p className="text-sm text-muted-foreground">
                {calendarEvent.dtstart.toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}{" "}
                at{" "}
                {calendarEvent.dtstart.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {calendarEvent.dtend && (
                  <>
                    {" "}&ndash;{" "}
                    {calendarEvent.dtend.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </p>
            )}
            {calendarEvent.location && (
              <p className="text-sm text-muted-foreground">{calendarEvent.location}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="calendar-apartment" className="text-sm font-medium">Link to apartment *</label>
            <ApartmentPicker
              value={calendarApartmentId}
              onChange={setCalendarApartmentId}
              suggestedId={calendarSuggestedId}
            />
            {calendarSuggestedId && calendarApartmentId === calendarSuggestedId && (
              <p className="text-xs text-muted-foreground">Auto-matched from event location</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="calendar-notes" className="text-sm font-medium">Notes</label>
            <textarea
              id="calendar-notes"
              value={calendarNotes}
              onChange={(e) => setCalendarNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleSaveCalendar}
              disabled={!calendarApartmentId || !calendarEvent.dtstart}
            >
              Save Appointment
            </Button>
            <Button variant="outline" onClick={() => router.push("/homesearch")}>
              Discard
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Shared Listing</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Review the parsed details and save when ready.
      </p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Address *</label>
          <Input
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="123 Main St"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Suburb</label>
          <Input
            value={form.suburb}
            onChange={(e) => setForm((f) => ({ ...f, suburb: e.target.value }))}
            placeholder="e.g. Bondi"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Rent/week ($)</label>
            <Input
              type="number"
              value={form.rent_per_week}
              onChange={(e) => setForm((f) => ({ ...f, rent_per_week: e.target.value }))}
              placeholder="500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bedrooms</label>
            <Input
              type="number"
              value={form.bedrooms}
              onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))}
              placeholder="2"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bathrooms</label>
            <Input
              type="number"
              value={form.bathrooms}
              onChange={(e) => setForm((f) => ({ ...f, bathrooms: e.target.value }))}
              placeholder="1"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.parking}
            onChange={(e) => setForm((f) => ({ ...f, parking: e.target.checked }))}
            className="size-4 rounded"
          />
          <span className="text-sm font-medium">Has parking</span>
        </label>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Agent</label>
          <AgentSelector value={agentId} onChange={setAgentId} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={!form.address.trim()}>
            Save Apartment
          </Button>
          <Button variant="outline" onClick={() => router.push("/homesearch")}>
            Discard
          </Button>
        </div>
      </div>
    </main>
  );
}
