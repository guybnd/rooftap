import { NextResponse } from "next/server";
import { cleanCrashReport } from "@homeup/core";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { receiveCrash } from "@/lib/crash-reports";

// A crash report from this server's own apps, sent on its own by the error
// screen (core crash-report.ts). The report is rebuilt and scrubbed again
// here, so only its fixed fields are kept. Signed-in people only, so each
// person's daily share can be counted.

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const report = cleanCrashReport(await request.json().catch(() => null));
  if (!report) return NextResponse.json({ error: "Send a crash report" }, { status: 400 });
  try {
    return NextResponse.json(await receiveCrash(createAdminClient(), report, { userId: user.id }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the report" }, { status: 500 });
  }
}
