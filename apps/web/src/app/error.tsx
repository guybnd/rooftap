"use client";

// The web app's "This screen didn't load": Next.js shows it when a page
// throws while rendering, inside the app's own frame. Phone twin:
// apps/mobile/src/components/error-fallback.tsx.
//
// Like the phone, it reports the crash on its own (core crash-report.ts) to
// this server, unless this browser switched that off in Settings > About &
// updates. "Show details" shows exactly what was sent; with reports off, a
// button there sends it by hand. The web app is served by the server it
// reports to, so a report that can't be sent isn't kept for later.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  buildCrashReport,
  crashReceiptNote,
  crashReportLines,
  reportCrash,
  type CrashContext,
  type CrashOutcome,
  type CrashReceipt,
  type CrashSender,
} from "@homeup/core";
import { Button } from "@/components/ui/button";

/** The browser and OS by family only, e.g. "Firefox on Windows". */
function browserName(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

function crashContext(): CrashContext {
  return {
    platform: "web",
    path: typeof window === "undefined" ? null : window.location.pathname,
    os: typeof navigator === "undefined" ? null : browserName(navigator.userAgent),
  };
}

const sendCrash: CrashSender = async (report) => {
  const res = await fetch("/api/feedback/crash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!res.ok) return null;
  return (await res.json()) as CrashReceipt;
};

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const report = useMemo(() => buildCrashReport(error, crashContext()), [error]);
  const [outcome, setOutcome] = useState<CrashOutcome | null>(null);

  useEffect(() => {
    console.error("[ErrorBoundary]", error);
    let live = true;
    void reportCrash(report, sendCrash)
      .catch((): CrashOutcome => "skipped")
      .then((result) => live && setOutcome(result));
    return () => {
      live = false;
    };
  }, [error, report]);

  const sendByHand = useCallback(() => {
    setOutcome("skipped");
    void reportCrash(report, sendCrash, { byHand: true })
      .catch((): CrashOutcome => "skipped")
      .then(setOutcome);
  }, [report]);

  const sentNote = crashReceiptNote(outcome === "known" || (outcome && typeof outcome === "object") ? outcome : null);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-8 py-12">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <RefreshCw className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-semibold">This screen didn&apos;t load</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Something in the app tripped up. Reload the page, or try again.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button size="lg" className="h-11" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
        <Button size="lg" variant="ghost" className="h-11" onClick={() => reset()}>
          Try again
        </Button>
      </div>
      {sentNote && <p className="text-center text-xs text-muted-foreground">{sentNote}</p>}
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-2"
        onClick={() => setShowDetails((v) => !v)}
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>
      {showDetails && (
        <div className="flex w-full max-w-md flex-col gap-3">
          <div className="space-y-1 rounded-xl bg-muted p-3 font-mono text-xs">
            {crashReportLines(report).map((line, i) => (
              <p key={i} className="break-words">
                <span className="inline-block w-14 text-muted-foreground">{line.label}</span>
                {line.value}
              </p>
            ))}
          </div>
          {outcome === "off" && (
            <Button size="lg" variant="outline" className="h-11" onClick={sendByHand}>
              Send this report
            </Button>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {outcome === "off"
              ? "Crash reports are off in this browser. Only what you see above is sent."
              : "This is everything the report holds. Turn reports off in Settings > About & updates."}
          </p>
        </div>
      )}
    </div>
  );
}
