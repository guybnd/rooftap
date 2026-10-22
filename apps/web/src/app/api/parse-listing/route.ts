import { NextResponse } from "next/server";
import { AiBlockedError, aiBlockedResponse, recordAiRead, resolveAiKey, type ResolvedAiKey } from "@/lib/ai/access";
import { parseListingFromHtml, parseListingFromImages } from "@/lib/ai/parser";
import { extractPdfText, extractImagesFromPdf } from "@/lib/pdf-server";
import { resolveServerKey } from "@/lib/admin-config";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { requireModules } from "@/lib/server-modules";
import { assertPublicUrl } from "@/lib/event-page";
import { APARTMENT_PHOTO_URL_TTL_SECONDS } from "@homeup/core";

export const maxDuration = 60;


function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const REA_LISTING_RE = /^https?:\/\/(www\.)?realestate\.com\.au\/property-[^?#]+/;

function toReaPdfUrl(url: string): string | null {
  const match = url.match(REA_LISTING_RE);
  if (!match) return null;
  const base = url.split("?")[0].split("#")[0];
  return base.endsWith(".pdf") ? base : `${base}.pdf`;
}

async function fetchPdf(pdfUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(pdfUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      Accept: "application/pdf,*/*",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
  }
  return res.arrayBuffer();
}

async function fetchListingHtml(url: string): Promise<string> {
  const scraperApiKey = await resolveServerKey("SCRAPER_API_KEY");

  if (scraperApiKey) {
    const hostname = new URL(url).hostname;
    const params = new URLSearchParams({
      api_key: scraperApiKey,
      url,
      render: "true",
    });
    const fetchUrl = `https://api.scraperapi.com?${params}`;

    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (body.includes("upgrade your plan")) {
        throw new Error(
          `ScraperAPI requires a paid plan for ${hostname}. Try a domain.com.au link instead, or upgrade your ScraperAPI plan.`
        );
      }
      throw new Error(`ScraperAPI returned HTTP ${res.status} for ${hostname}`);
    }
    return res.text();
  }

  // A pasted link must not reach the server's own network (localhost, the
  // LAN, cloud metadata), so every hop of a redirect is checked too.
  let target = await assertPublicUrl(url);
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(target, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) break;
    target = await assertPublicUrl(new URL(location, target).toString());
    res = null;
  }
  if (!res) throw new Error("The listing link redirected too many times.");

  if (!res.ok) {
    throw new Error(`Listing site returned HTTP ${res.status}. Try a domain.com.au link, or add SCRAPER_API_KEY.`);
  }
  return res.text();
}

export async function POST(request: Request) {
  // Gate this AI-cost endpoint behind a valid session.
  const authClient = await createServerSupabase();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Listings belong to Home Search (.docs/modules.md).
  const off = await requireModules(user.id, "search");
  if (off) return off;
  let aiKey: ResolvedAiKey;
  try {
    aiKey = await resolveAiKey(user.id, "listing");
  } catch (e) {
    if (e instanceof AiBlockedError) return aiBlockedResponse(e);
    throw e;
  }

  const { url, html: providedHtml, text, images } = await request.json();

  if (!url && !text && !images?.length) {
    return NextResponse.json({ error: "URL, text, or images required" }, { status: 400 });
  }

  if (url) {
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  }

  try {
    if (images?.length) {
      const parsed = await parseListingFromImages(images, url, aiKey);
      await recordAiRead(aiKey);
      return NextResponse.json(parsed);
    }

    // realestate.com.au: try PDF extraction, fall back to HTML scraping
    if (url) {
      const pdfUrl = toReaPdfUrl(url);
      if (pdfUrl) {
        try {
          const buffer = await fetchPdf(pdfUrl);
          const pdfImages = await extractImagesFromPdf(buffer);
          const pdfText = await extractPdfText(buffer);
          const parsed = await parseListingFromHtml(pdfText, url, aiKey);
          await recordAiRead(aiKey);
          if (pdfImages.length > 0) {
            const supabase = createServiceClient();
            const uploadedUrls: string[] = [];
            for (const dataUrl of pdfImages) {
              const base64 = dataUrl.split(",")[1];
              const buf = Buffer.from(base64, "base64");
              const path = `pdf-extracts/${crypto.randomUUID()}.jpg`;
              const { error } = await supabase.storage
                .from("apartment-photos")
                .upload(path, buf, { contentType: "image/jpeg" });
              if (!error) {
                // Signed, not public, so previews keep working once the
                // bucket is private. Saved rows map back to the path
                // (core apartmentPhotoPath) and are re-signed on display.
                const { data: urlData } = await supabase.storage
                  .from("apartment-photos")
                  .createSignedUrl(path, APARTMENT_PHOTO_URL_TTL_SECONDS);
                if (urlData) uploadedUrls.push(urlData.signedUrl);
              }
            }
            if (uploadedUrls.length > 0) {
              parsed.image_urls = uploadedUrls;
            }
          }
          return NextResponse.json(parsed);
        } catch {
          // PDF fetch failed (blocked IP, etc.) — fall through to HTML scraping
        }
      }
    }

    let content: string;
    if (text) {
      content = text;
    } else if (providedHtml) {
      content = providedHtml;
    } else {
      content = await fetchListingHtml(url);
    }

    const parsed = await parseListingFromHtml(content, url || "pasted text", aiKey);
    await recordAiRead(aiKey);
    return NextResponse.json(parsed);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = (e as { status?: number })?.status;
    console.error("[parse-listing] Error:", { message, status, name: (e as Error)?.name });
    if (message.includes("OPENAI_API_KEY")) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Parse failed: ${message}`, openaiStatus: status },
      { status: status === 429 ? 429 : 500 }
    );
  }
}
