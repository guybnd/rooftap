import { generateIcs, type IcsEvent } from "@homeup/core";

export type { IcsEvent };
export { generateIcs };

// HOUP-67: only this browser-only download/share trigger stays in apps/web —
// `generateIcs` (the pure .ics string builder) now lives in packages/core
// since it has no browser dependency and both platforms need it. This
// function uses the Web Share API + anchor-download fallback, neither of
// which exists on RN.
export async function downloadIcs(event: IcsEvent, filenameHint: string): Promise<void> {
  const icsContent = generateIcs(event);
  const filename = `viewing-${filenameHint.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.ics`;
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });

  if (navigator.canShare?.({ files: [new File([blob], filename, { type: "text/calendar" })] })) {
    await navigator.share({
      files: [new File([blob], filename, { type: "text/calendar" })],
    });
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
