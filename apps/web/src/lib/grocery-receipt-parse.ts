import type { ParsedReceipt } from "@homeup/core";

/** Read a file as a data URL (for the parse-receipt API). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Send a receipt to the parser. PDFs go via the `pdf` field, images via `images`. */
export async function parseReceiptFile(file: File): Promise<ParsedReceipt | null> {
  try {
    const dataUrl = await fileToDataUrl(file);
    const body = file.type === 'application/pdf'
      ? { pdf: dataUrl }
      : { images: [dataUrl] };
    const res = await fetch('/api/parse-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.error('parse-receipt failed:', res.status); return null; }
    return (await res.json()) as ParsedReceipt;
  } catch (err) {
    console.error('parseReceiptFile failed:', err);
    return null;
  }
}
