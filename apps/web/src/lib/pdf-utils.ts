const MAX_PDF_PAGES = 3;
const PDF_RENDER_WIDTH = 1200;
const JPEG_QUALITY = 0.7;

export async function renderPdfToImages(
  file: File | ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const images: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    onProgress?.(i, pageCount);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({
      scale: PDF_RENDER_WIDTH / page.getViewport({ scale: 1 }).width,
    });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }

  return images;
}
