import { NextResponse } from "next/server";
import { parseModuleList } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMoneySummaries } from "@/lib/money-summaries";

// Money summaries from the Assistant: Vercel Cron calls this every morning in
// Australia (apps/web/vercel.json) with `Authorization: Bearer $CRON_SECRET`;
// a self-hosted server schedules the same request itself
// (.docs/self-hosting.md). It posts each household's weekly note on Sunday
// and its monthly recap on the 1st, by the clock of the person who asked
// (lib/money-summaries.ts). A note posts once per period, so extra runs do nothing.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runMoneySummaries(createAdminClient(), { available: parseModuleList(process.env.HOMEUP_MODULES) });
  return NextResponse.json(result);
}
