import { NextResponse } from "next/server";
import { cleanCrashReport } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { feedbackGithub } from "@/lib/feedback";
import { receiveCrash } from "@/lib/crash-reports";

// Crash reports that self-hosted servers pass on to the Rooftap team, when
// their operator chose to share them (apps/web/src/lib/crash-reports.ts).
// Only the hosted server takes them: elsewhere this route answers 404.
//
// Self-hosted servers have no account here, so the route is open and kept
// narrow instead: the report is rebuilt and scrubbed from its fixed fields,
// the sending server's address is never stored, repeats only count up, and
// daily caps bound how many reports and new issues all servers together add.

export async function POST(request: Request) {
  if (!feedbackGithub()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { report?: unknown; server?: unknown } | null;
  const report = cleanCrashReport(body?.report);
  if (!report) return NextResponse.json({ error: "Send a crash report" }, { status: 400 });
  const server = typeof body?.server === "string" ? body.server.replace(/[^\w.-]/g, "").slice(0, 40) || null : null;
  try {
    return NextResponse.json(await receiveCrash(createAdminClient(), report, { upstream: server }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the report" }, { status: 500 });
  }
}
