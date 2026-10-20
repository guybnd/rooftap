import { join } from "path";
import { pathToFileURL } from "url";
import { inflate } from "zlib";
import { promisify } from "util";
import sharp from "sharp";

const MAX_PAGES = 5;
const MIN_IMAGE_DIM = 150;

const inflateAsync = promisify(inflate);

interface PdfImage {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  data: Buffer;
}

export async function extractImagesFromPdf(pdfBuffer: ArrayBuffer): Promise<string[]> {
  const buf = Buffer.from(pdfBuffer);
  const str = buf.toString("latin1");

  const rawImages: PdfImage[] = [];
  const objRegex = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  let match;

  while ((match = objRegex.exec(str)) !== null) {
    const header = match[2];
    if (!header.includes("/Subtype") || !header.match(/\/Subtype\s*\/Image/)) continue;
    if (!header.match(/\/Filter\s*\/FlateDecode/)) continue;

    const wMatch = header.match(/\/Width\s+(\d+)/);
    const hMatch = header.match(/\/Height\s+(\d+)/);
    const lenMatch = header.match(/\/Length\s+(\d+)/);
    const csMatch = header.match(/\/ColorSpace\s*\/(\w+)/);

    if (!wMatch || !hMatch || !lenMatch) continue;

    const width = parseInt(wMatch[1]);
    const height = parseInt(hMatch[1]);
    const streamLen = parseInt(lenMatch[1]);
    const colorSpace = csMatch?.[1] || "DeviceRGB";

    if (width < MIN_IMAGE_DIM || height < MIN_IMAGE_DIM) continue;

    const channels: 1 | 3 | 4 = colorSpace === "DeviceGray" ? 1
      : colorSpace === "DeviceCMYK" ? 4
      : 3;

    const streamStart = match.index + match[0].length;
    const streamEnd = streamStart + streamLen;

    if (streamEnd > buf.length || streamLen <= 0) continue;

    // Find actual endstream marker to validate boundaries
    const endMarker = buf.indexOf("endstream", streamStart);
    const actualEnd = endMarker !== -1 && endMarker < streamEnd ? endMarker : streamEnd;
    const compressedData = Buffer.from(buf.subarray(streamStart, actualEnd));

    try {
      const data = await inflateAsync(compressedData);
      const expectedSize = width * height * channels;
      if (data.length === expectedSize) {
        rawImages.push({ width, height, channels, data });
      }
    } catch {
      // skip streams that fail to decompress
    }
  }

  const results: string[] = [];
  for (const img of rawImages) {
    try {
      const jpegBuf = await sharp(img.data, {
        raw: { width: img.width, height: img.height, channels: img.channels },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      results.push(`data:image/jpeg;base64,${jpegBuf.toString("base64")}`);
    } catch {
      // skip images that fail to encode
    }
  }

  return results;
}

export async function extractPdfText(pdfBuffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
  ).href;

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
  }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ");
    pages.push(text);
  }

  return pages.join("\n\n");
}
