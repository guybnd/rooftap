import { NextResponse } from "next/server";
import { parseModuleList } from "@homeup/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMoneySummaries } from "@/lib/money-summaries";

// The weekly money digest, kept for self-hosted servers whose cron still
// calls it on Sunday (.docs/self-hosting.md). It posts the weekly note
// whatever the day; /api/money/summaries, called daily, now does this and the
// monthly recap. The two can't double up: a weekly note posts once in five days.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runMoneySummaries(createAdminClient(), {
    available: parseModuleList(process.env.HOMEUP_MODULES),
    kinds: ["weekly"],
    anyDay: true,
  });
  return NextResponse.json(result);
}
