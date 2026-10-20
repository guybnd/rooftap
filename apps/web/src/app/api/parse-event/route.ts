import { NextResponse } from "next/server";
import { documentBucket, normalizeParsedEvent, type Document } from "@homeup/core";
import { parseEventDetails } from "@/lib/ai/parser";
import { extractImagesFromPdf, extractPdfText } from "@/lib/pdf-server";
import { eventPageText, fetchEventPage } from "@/lib/event-page";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";
import { createAdminClient } from "@/lib/supabase/admin";
import { getR2Config, r2Download, r2Key, R2_BUCKETS } from "@/lib/r2-storage";

// Calendar: fill an event from a link or a ticket. Takes one of `url` (an
// event or ticketing page), `images` (ticket photos or screenshots as data
// URLs), `pdf` (a ticket PDF, base64) or `documentId` (a photo or PDF already
// in the household's Documents, for "Add to calendar" there). Answers with core's
// ParsedEventDetails; the event form applies it. .ics files never come here,
// the device reads them with core's parseIcs.
export const maxDuration = 60;

export async function POST(request: Request) {
  // An AI-cost endpoint: session required, cookie on web or Bearer on native.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const off = await requireModules(user.id, "calendar");
  if (off) return off;

  const body = await request.json().catch(() => ({}));
  const { url, documentId } = body;
  let { images, pdf } = body;
  if (!url && !images?.length && !pdf && !documentId) {
    return NextResponse.json({ error: "A link, image or PDF is required" }, { status: 400 });
  }

  if (typeof documentId === "string" && documentId) {
    const file = await readGroupDocument(user.id, documentId);
    if ("error" in file) return NextResponse.json({ error: file.error }, { status: file.status });
    if (file.mimeType === "application/pdf") pdf = file.base64;
    else images = [`data:${file.mimeType};base64,${file.base64}`];
  }

  try {
    let raw: Record<string, unknown>;
    let sourceUrl: string | undefined;

    if (typeof url === "string" && url.trim()) {
      let page: { url: string; html: string };
      try {
        page = await fetchEventPage(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The page couldn't be read.";
        return NextResponse.json({ error: message }, { status: 422 });
      }
      sourceUrl = page.url;
      raw = await parseEventDetails({ text: eventPageText(page.html), url: page.url });
    } else if (Array.isArray(images) && images.length) {
      raw = await parseEventDetails({ images: images.slice(0, 4) });
    } else {
      const base64 = String(pdf).replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(base64, "base64");
      const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      // E-tickets are usually text PDFs; read the text, and fall back to
      // rendering the pages when there's too little of it (a scanned ticket).
      const text = await extractPdfText(arrayBuffer.slice(0)).catch(() => "");
      if (text.trim().length >= 80) {
        raw = await parseEventDetails({ text: text.slice(0, 30_000) });
      } else {
        const pages = await extractImagesFromPdf(arrayBuffer);
        if (!pages.length) {
          return NextResponse.json({ error: "Could not read the PDF." }, { status: 422 });
        }
        raw = await parseEventDetails({ images: pages.slice(0, 4) });
      }
    }

    const details = normalizeParsedEvent({ ...raw, source_url: sourceUrl });
    if (!details.title && !details.start_date) {
      return NextResponse.json({ error: "No event details found there." }, { status: 422 });
    }
    return NextResponse.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parse failed";
    const status = message.includes("is not configured") ? 500 : 502;
    return NextResponse.json({ error: `Parse failed: ${message}` }, { status });
  }
}

/** A document from one of the user's households, as base64, read with the service role after a membership check. */
async function readGroupDocument(
  userId: string,
  documentId: string
): Promise<{ base64: string; mimeType: string } | { error: string; status: number }> {
  const admin = createAdminClient();
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).eq("deleted", false).maybeSingle();
  const document = doc as Document | null;
  if (!document) return { error: "That document wasn't found.", status: 404 };
  const { data: member } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", document.group_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return { error: "That document wasn't found.", status: 404 };
  const mimeType = document.mime_type ?? "";
  if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
    return { error: "Only a photo or PDF can fill an event.", status: 422 };
  }
  const bucket = documentBucket(document.source);
  // Hosted: the R2 copy when there is one (.docs/r2-storage.md).
  const r2 = getR2Config();
  if (r2 && R2_BUCKETS.has(bucket)) {
    const bytes = await r2Download(r2, r2Key(bucket, document.storage_path)).catch(() => null);
    if (bytes) return { base64: Buffer.from(bytes).toString("base64"), mimeType };
  }
  const { data: blob, error } = await admin.storage.from(bucket).download(document.storage_path);
  if (error || !blob) return { error: "That document couldn't be read.", status: 502 };
  return { base64: Buffer.from(await blob.arrayBuffer()).toString("base64"), mimeType };
}
