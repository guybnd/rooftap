"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Sparkles, Loader2, Camera, FileText, X } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { createClient } from "@/lib/supabase/client";
import { geocodeAddress } from "@/lib/geocode";
import { fetchNearestPoiDistancesClient } from "@/lib/nearest-pois-client";
import { useDataCache } from "@/lib/data-cache";
import { apartments$, agents$, apartmentAgents$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import type { Agent } from '@homeup/core';
import { renderPdfToImages } from "@/lib/pdf-utils";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MultiAgentSelector } from "@/components/multi-agent-selector";
import { OfflineHint } from "@/components/offline-hint";

const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20MB
const REA_LISTING_RE = /^https?:\/\/(www\.)?realestate\.com\.au\/property-[^?#]+/;

function toReaPdfUrl(url: string): string | null {
  const match = url.match(REA_LISTING_RE);
  if (!match) return null;
  const base = url.split("?")[0].split("#")[0];
  return base.endsWith(".pdf") ? base : `${base}.pdf`;
}

async function fetchPdfClientSide(pdfUrl: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

interface ParsedImages {
  urls: string[];
}

export default function NewApartmentPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <NewApartmentPage />
    </Suspense>
  );
}

function NewApartmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { group, isOnline, currentUserId } = useDataCache();

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

  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pdfHintUrl, setPdfHintUrl] = useState<string | null>(null);
  const [parsedImages, setParsedImages] = useState<ParsedImages | null>(null);
  const [form, setForm] = useState({
    address: "",
    suburb: "",
    rent_per_week: "",
    bedrooms: "",
    bathrooms: "",
    parking: false,
    listing_url: "",
    notes: "",
  });

  const [pastedText, setPastedText] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([]);
  const [pdfImages, setPdfImages] = useState<string[]>([]);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [autoParseTriggered, setAutoParseTriggered] = useState(false);

  useEffect(() => {
    const sharedUrl = searchParams.get("listing_url");
    if (sharedUrl && !autoParseTriggered) {
      setForm((f) => ({ ...f, listing_url: sharedUrl }));
      setAutoParseTriggered(true);
    }
  }, [searchParams, autoParseTriggered]);

  useEffect(() => {
    if (autoParseTriggered && form.listing_url && !parsing && isOnline) {
      handleParse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoParseTriggered, isOnline]);

  const handleScreenshots = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPdfImages([]);
    setPdfName(null);
    setPdfError(null);
    setScreenshots((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setScreenshotPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeScreenshot = (index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
    setScreenshotPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handlePdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > MAX_PDF_SIZE) {
      setPdfError("PDF must be under 20MB");
      return;
    }

    setPdfError(null);
    setPdfLoading(true);
    setPdfProgress("Loading PDF");
    setPdfName(file.name);
    setScreenshots([]);
    screenshotPreviews.forEach((url) => URL.revokeObjectURL(url));
    setScreenshotPreviews([]);

    try {
      const images = await renderPdfToImages(file, (current, total) => {
        setPdfProgress(`Rendering page ${current} of ${total}`);
      });
      setPdfImages(images);
    } catch {
      setPdfError("Failed to process PDF");
      setPdfName(null);
      setPdfImages([]);
    } finally {
      setPdfLoading(false);
      setPdfProgress(null);
    }
  };

  const removePdf = () => {
    setPdfImages([]);
    setPdfName(null);
    setPdfError(null);
  };

  const handleParse = async () => {
    if (!isOnline) return;
    const url = form.listing_url.trim();
    const text = pastedText.trim();
    const hasScreenshots = screenshots.length > 0;
    const hasPdf = pdfImages.length > 0;
    if (!url && !text && !hasScreenshots && !hasPdf) return;

    setParsing(true);
    setParseError(null);
    setPdfHintUrl(null);
    setParsedImages(null);

    try {
      let images: string[] | undefined;
      if (hasPdf) {
        images = pdfImages;
      } else if (hasScreenshots) {
        images = await Promise.all(
          screenshots.map(
            (file) =>
              new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
              })
          )
        );
      } else if (url) {
        const pdfUrl = toReaPdfUrl(url);
        if (pdfUrl) {
          const pdfBuffer = await fetchPdfClientSide(pdfUrl);
          if (pdfBuffer) {
            images = await renderPdfToImages(pdfBuffer);
          } else {
            setParsing(false);
            setParseError(
              `Can't fetch this PDF directly. Download it first (the download button in Chrome's PDF viewer), then share the downloaded file to Rooftap.`
            );
            setPdfHintUrl(pdfUrl);
            return;
          }
        }
      }

      const res = await fetch("/api/parse-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url || undefined, text: text || undefined, images }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMsg = "Failed to parse listing";
        try { errorMsg = JSON.parse(text).error || errorMsg; } catch { errorMsg = text || errorMsg; }
        setParseError(errorMsg);
        return;
      }
      setPdfHintUrl(null);
      const data = await res.json();

      setForm((f) => ({
        ...f,
        address: data.address || f.address,
        suburb: data.suburb || f.suburb,
        rent_per_week: data.rent_per_week ? String(data.rent_per_week) : f.rent_per_week,
        bedrooms: data.bedrooms ? String(data.bedrooms) : f.bedrooms,
        bathrooms: data.bathrooms ? String(data.bathrooms) : f.bathrooms,
        parking: data.parking ?? f.parking,
        notes: data.notes || f.notes,
      }));

      if (data.image_urls?.length) {
        setParsedImages({ urls: data.image_urls });
      }

      const parsedAgents: Array<{ name: string; phone?: string }> = data.agents?.length
        ? data.agents
        : data.agent_name
          ? [{ name: data.agent_name, phone: data.agent_phone }]
          : [];

      if (parsedAgents.length > 0 && group) {
        const colors = ["#ef4444","#f97316","#f59e0b","#84cc16","#22c55e","#06b6d4","#3b82f6","#6366f1","#a855f7","#ec4899"];
        const resolvedIds: string[] = [];
        let currentAgents = agents;

        for (const pa of parsedAgents) {
          const match = currentAgents.find(
            (a) => a.name.toLowerCase() === pa.name.toLowerCase()
          );
          if (match) {
            resolvedIds.push(match.id);
          } else {
            const used = new Set(currentAgents.map((a) => a.color));
            const available = colors.filter((c) => !used.has(c));
            const pool = available.length > 0 ? available : colors;
            const color = pool[Math.floor(Math.random() * pool.length)];
            const newAgent: Agent = {
              id: crypto.randomUUID(),
              user_id: currentUserId ?? "",
              group_id: group.id,
              name: pa.name,
              phone: pa.phone || null,
              color,
              notes: null,
              deleted: false,
              created_at: null as unknown as string,
              updated_at: null as unknown as string,
            };
            writeAgent(newAgent);
            resolvedIds.push(newAgent.id);
            currentAgents = [...currentAgents, newAgent];
          }
        }

        if (resolvedIds.length > 0) {
          setAgentIds(resolvedIds);
        }
      }
    } catch {
      setParseError("Network error: could not reach parser");
    } finally {
      setParsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.address.trim() || !group) return;
    setSaving(true);

    const apartmentId = crypto.randomUUID();
    writeApartment({
      id: apartmentId,
      user_id: currentUserId ?? "",
      group_id: group.id,
      address: form.address.trim(),
      suburb: form.suburb.trim() || null,
      rent_per_week: form.rent_per_week ? Number(form.rent_per_week) : null,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
      parking: form.parking,
      listing_url: form.listing_url.trim() || null,
      notes: form.notes.trim() || null,
      lat: null,
      lng: null,
      agent_id: agentIds[0] ?? null,
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

    if (agentIds.length > 0) {
      for (const agent_id of agentIds) {
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

    const coords = await geocodeAddress(form.address.trim(), form.suburb.trim() || null);
    if (coords) {
      patchApartment(apartmentId, { lat: coords.lat, lng: coords.lng });
      fetchNearestPoiDistancesClient(coords.lat, coords.lng).then((distances) => {
        if (distances.nearest_supermarket_m != null || distances.nearest_transport_m != null) {
          patchApartment(apartmentId, distances);
        }
      });
    }

    const supabase = createClient();

    if (parsedImages?.urls.length) {
      const photoRows = parsedImages.urls.map((imageUrl, i) => ({
        apartment_id: apartmentId,
        storage_path: imageUrl,
        caption: "listing",
        is_main: i === 0,
      }));
      await supabase.from("photos").insert(photoRows);
    }

    if (screenshots.length) {
      const hasMainAlready = (parsedImages?.urls.length ?? 0) > 0;
      let firstSaved = false;
      for (const file of screenshots) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${apartmentId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("photos")
          .upload(path, file);
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("photos").getPublicUrl(path);
          await supabase.from("photos").insert({
            apartment_id: apartmentId,
            storage_path: urlData.publicUrl,
            caption: "screenshot",
            is_main: !hasMainAlready && !firstSaved,
          });
          firstSaved = true;
        }
      }
    }

    toast.success("Apartment added");
    router.push(`/apartment/${apartmentId}`);
  };

  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto">
      <Link
        href="/homesearch"
        className="-ml-2 mb-4 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      {/* Hearth v2 pass: a Display-step title with its one secondary action
          beside it; the form splits into "From a listing" (the auto-fill
          sources) and "Details", each under a Title-step heading. */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">Add apartment</h1>
        <Link
          href="/apartment/bulk"
          className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          Bulk upload
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h2 className="font-heading text-base font-semibold">From a listing</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">A link, the listing text, screenshots or a PDF, then Auto-fill</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Listing URL</label>
          <Input
            type="url"
            placeholder="https://..."
            value={form.listing_url}
            onChange={(e) => setForm((f) => ({ ...f, listing_url: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Paste listing text</label>
          <textarea
            placeholder="Paste the listing description"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Screenshots</label>
          {pdfImages.length > 0 ? (
            <p className="text-xs text-muted-foreground">Remove the PDF above to use screenshots instead.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {screenshotPreviews.map((src, i) => (
                  <div key={i} className="relative w-20 h-20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="w-full h-full object-cover rounded-xl border border-border/60" />
                    <button
                      type="button"
                      onClick={() => removeScreenshot(i)}
                      aria-label="Remove screenshot"
                      className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <label className="w-20 h-20 rounded-xl border border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-foreground/40 transition-colors">
                  <Camera className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground mt-0.5">Add</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleScreenshots}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">AI reads the details and keeps the images</p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">PDF</label>
          {screenshots.length > 0 ? (
            <p className="text-xs text-muted-foreground">Remove screenshots above to use a PDF instead.</p>
          ) : pdfName ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{pdfName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{pdfImages.length} page{pdfImages.length !== 1 ? "s" : ""}</span>
                <button
                  type="button"
                  onClick={removePdf}
                  aria-label="Remove PDF"
                  className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {pdfImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pdfImages.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt={`Page ${i + 1}`} className="w-14 h-20 object-contain rounded-lg border border-border/60" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <label className="flex min-h-11 items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-border cursor-pointer hover:border-foreground/40 transition-colors">
              {pdfLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm text-muted-foreground">{pdfLoading ? (pdfProgress || "Processing PDF") : "Upload listing PDF"}</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePdf}
                disabled={pdfLoading}
                className="hidden"
              />
            </label>
          )}
          {!screenshots.length && pdfError && <p className="text-sm text-destructive">{pdfError}</p>}
          {!screenshots.length && <p className="text-xs text-muted-foreground">A PDF exported from a listing site, read page by page</p>}
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            onClick={handleParse}
            disabled={parsing || !isOnline || (!form.listing_url.trim() && !pastedText.trim() && !screenshots.length && !pdfImages.length)}
            className="h-11 w-full rounded-xl sm:w-auto"
          >
            {parsing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="ml-1.5">{parsing ? "Reading listing" : "Auto-fill"}</span>
          </Button>
          {!isOnline && <OfflineHint className="mt-1.5" />}
          {parseError && (
            <div className="mt-1.5">
              <p className="text-sm text-destructive">{parseError}</p>
              {pdfHintUrl && (
                <a
                  href={pdfHintUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex mt-1 min-h-9 items-center text-sm text-primary underline underline-offset-2"
                >
                  Open PDF
                </a>
              )}
            </div>
          )}
          {parsedImages && (
            <p className="text-sm text-muted-foreground mt-1.5">
              {parsedImages.urls.length} listing image{parsedImages.urls.length !== 1 ? "s" : ""} found, saved with the apartment
            </p>
          )}
        </div>

        <h2 className="pt-4 font-heading text-base font-semibold">Details</h2>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Address <span className="text-xs font-normal text-muted-foreground">required</span>
          </label>
          <Input
            placeholder="123 Main St"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Suburb</label>
          <Input
            placeholder="e.g. Bondi"
            value={form.suburb}
            onChange={(e) => setForm((f) => ({ ...f, suburb: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium whitespace-nowrap">Rent <span className="font-normal text-muted-foreground">/wk</span></label>
            <Input
              type="number"
              placeholder="500"
              value={form.rent_per_week}
              onChange={(e) => setForm((f) => ({ ...f, rent_per_week: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bedrooms</label>
            <Input
              type="number"
              placeholder="2"
              value={form.bedrooms}
              onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bathrooms</label>
            <Input
              type="number"
              placeholder="1"
              value={form.bathrooms}
              onChange={(e) => setForm((f) => ({ ...f, bathrooms: e.target.value }))}
            />
          </div>
        </div>

        <label className="flex min-h-11 items-center gap-2.5 cursor-pointer">
          {/* Themed checkbox: the native box renders white on the night
              ground; checked fills with the accent (a toggle-on, H2). */}
          <span className="relative inline-flex size-5 shrink-0">
            <input
              type="checkbox"
              checked={form.parking}
              onChange={(e) => setForm((f) => ({ ...f, parking: e.target.checked }))}
              className="peer size-5 cursor-pointer appearance-none rounded-md border border-border bg-transparent transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Check className="pointer-events-none absolute inset-0 m-auto hidden h-3.5 w-3.5 text-primary-foreground peer-checked:block" />
          </span>
          <span className="text-sm font-medium">Has parking</span>
        </label>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Notes</label>
          <textarea
            placeholder="Any notes about this place"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Agents</label>
          <MultiAgentSelector value={agentIds} onChange={setAgentIds} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={saving || !form.address.trim()} className="h-11 flex-1 rounded-xl sm:flex-none sm:px-5">
            {saving ? "Saving" : "Save apartment"}
          </Button>
          <Link href="/homesearch" className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-5")}>
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
