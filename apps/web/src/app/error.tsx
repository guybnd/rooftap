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
import { ChevronDown, ChevronUp, RotateCcw, RotateCw, type LucideIcon } from "lucide-react";
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
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from "@/components/ui/list-item";
import { RooftapTile } from "@/components/brand/rooftap-mark";

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
      <RooftapTile size="xl" />
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-semibold">This screen tripped</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Your data is safe. Reload the page to get the newest version, or try again.</p>
      </div>
      <div className="w-full max-w-sm">
        <ListGroup>
          <ActionRow Icon={RotateCw} title="Reload the page" meta="Gets the newest version" primary onClick={() => window.location.reload()} />
          <ActionRow Icon={RotateCcw} title="Try again" onClick={() => reset()} />
          <ListItem asChild>
            <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)} className="w-full items-center text-left hover:bg-muted/60">
              <ListItemContent>
                <ListItemTitle>What we sent</ListItemTitle>
                <ListItemMeta>
                  <span className="text-xs text-muted-foreground">
                    {sentNote ?? (outcome === null ? "Sending a report" : outcome === "off" ? "Reports are off in this browser" : "See what the report holds")}
                  </span>
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing className="mt-0">
                {showDetails ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
              </ListItemTrailing>
            </button>
          </ListItem>
        </ListGroup>
      </div>
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

/** One action on the crash screen: a neutral tile, a title, an optional line. */
function ActionRow({ Icon, title, meta, primary = false, onClick }: { Icon: LucideIcon; title: string; meta?: string; primary?: boolean; onClick: () => void }) {
  return (
    <ListItem asChild>
      <button type="button" onClick={onClick} className="w-full items-center text-left hover:bg-muted/60">
        <ListItemLeading className="mt-0">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-muted">
            <Icon className="size-[18px] text-foreground" />
          </span>
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle className={primary ? "text-primary" : undefined}>{title}</ListItemTitle>
          {meta && (
            <ListItemMeta>
              <span className="text-xs text-muted-foreground">{meta}</span>
            </ListItemMeta>
          )}
        </ListItemContent>
      </button>
    </ListItem>
  );
}
