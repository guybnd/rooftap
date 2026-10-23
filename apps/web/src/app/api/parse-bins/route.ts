import { NextResponse } from "next/server";
import { AiBlockedError, aiBlockedResponse, recordAiRead, resolveAiKey, type ResolvedAiKey } from "@/lib/ai/access";
import { parseBinCalendar } from "@/lib/ai/parser";
import { extractImagesFromPdf, extractPdfText } from "@/lib/pdf-server";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// Bin night: read a council bin calendar. Takes `images` (photos of the
// fridge magnet, as data URLs) or `pdf` (the council's PDF, base64). Answers
// the raw read; the setup sheet normalizes it with core's normalizeParsedBins
// and the person checks it before anything is saved.
export const maxDuration = 60;

export async function POST(request: Request) {
  // An AI-cost endpoint: session required, cookie on web or Bearer on native.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const off = await requireModules(user.id, "bins");
  if (off) return off;
  let aiKey: ResolvedAiKey;
  try {
    aiKey = await resolveAiKey(user.id, "bins");
  } catch (e) {
    if (e instanceof AiBlockedError) return aiBlockedResponse(e);
    throw e;
  }

  const body = await request.json().catch(() => ({}));
  const { images, pdf } = body ?? {};
  if (!(Array.isArray(images) && images.length) && !pdf) {
    return NextResponse.json({ error: "A photo or PDF is required" }, { status: 400 });
  }

  try {
    let raw: Record<string, unknown>;
    if (Array.isArray(images) && images.length) {
      raw = await parseBinCalendar({ images: images.slice(0, 4) }, aiKey);
    } else {
      const base64 = String(pdf).replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(base64, "base64");
      const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      // Council calendars are often drawn grids, so a page image reads better
      // than its text unless the text says plenty on its own.
      const text = await extractPdfText(arrayBuffer.slice(0)).catch(() => "");
      if (text.trim().length >= 400 && /\d{1,2}/.test(text)) {
        raw = await parseBinCalendar({ text: text.slice(0, 30_000) }, aiKey);
      } else {
        const pages = await extractImagesFromPdf(arrayBuffer);
        if (!pages.length) {
          return NextResponse.json({ error: "Could not read the PDF." }, { status: 422 });
        }
        raw = await parseBinCalendar({ images: pages.slice(0, 4) }, aiKey);
      }
    }
    await recordAiRead(aiKey);
    return NextResponse.json(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parse failed";
    const status = message.includes("is not configured") ? 500 : 502;
    return NextResponse.json({ error: `Parse failed: ${message}` }, { status });
  }
}
