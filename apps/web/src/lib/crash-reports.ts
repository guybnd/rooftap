import type { SupabaseClient } from "@supabase/supabase-js";
import {
  crashIssueBody,
  crashIssueTitle,
  crashReportLines,
  isCrashCountMilestone,
  type CrashReceipt,
  type CrashReport,
  type CrashSharing,
} from "@homeup/core";
import { getAdminConfigValue, setAdminConfigValue } from "@/lib/admin-config";
import { feedbackGithub, openIssue, serverVersion } from "@/lib/feedback";

// Crash reports from the error screen (core crash-report.ts). Every report
// lands in the operator's Feedback inbox, one row per distinct crash
// (`signature`), with repeats counted on that row.
//
// - The hosted server (FEEDBACK_GITHUB_* set) also opens one private GitHub
//   issue per crash, and edits its "Seen N times" line at round totals. It
//   takes reports from self-hosted servers too (/api/feedback/crash/upstream).
// - A self-hosted server keeps reports with its operator until the operator
//   chooses to share them (the Feedback panel's question, or
//   ROOFTAP_CRASH_REPORTS=share|off, which wins). Shared reports, and the
//   ones kept before the choice, go to ROOFTAP_CRASH_UPSTREAM (the hosted
//   server by default). The server's address never goes with them.

/** New reports one person's devices may file a day. Repeats of a known crash don't count. */
export const CRASH_USER_DAILY_MAX = 10;
/** New GitHub issues a day from this server's own apps. */
export const CRASH_ISSUES_DAILY_MAX = 20;
/** New GitHub issues a day from all self-hosted servers together. */
export const CRASH_UPSTREAM_ISSUES_DAILY_MAX = 10;
/** Reports a day the upstream route takes from all self-hosted servers together. */
export const CRASH_UPSTREAM_DAILY_MAX = 500;
/** Kept reports passed on at once when an operator says Share. */
const BACKLOG_MAX = 20;

const SHARING_KEY = "crash_reports_sharing";
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 6_000;

export const DEFAULT_CRASH_UPSTREAM = "https://homeup.vercel.app";

interface CrashRow {
  id: string;
  seen_count: number | null;
  issue_url: string | null;
  report: CrashReport | null;
  forwarded_at: string | null;
}

/** Where crash reports go from this server, and whether the env decides it. */
export async function crashSharing(): Promise<{ sharing: CrashSharing; fixed: boolean }> {
  if (feedbackGithub()) return { sharing: "hosted", fixed: true };
  const env = process.env.ROOFTAP_CRASH_REPORTS?.trim().toLowerCase();
  if (env === "share" || env === "off") return { sharing: env, fixed: true };
  const stored = await getAdminConfigValue(SHARING_KEY).catch(() => undefined);
  return { sharing: stored === "share" || stored === "off" ? stored : "ask", fixed: false };
}

/** The operator's answer to "Share crash reports with the Rooftap team?". */
export async function setCrashSharing(admin: SupabaseClient, value: "share" | "off"): Promise<void> {
  await setAdminConfigValue(SHARING_KEY, value);
  if (value === "share") await forwardKeptCrashes(admin);
}

function upstreamUrl(): string {
  const base = process.env.ROOFTAP_CRASH_UPSTREAM?.trim() || DEFAULT_CRASH_UPSTREAM;
  return `${base.replace(/\/+$/, "")}/api/feedback/crash/upstream`;
}

/** Passes one report to the Rooftap team. Only the report and this server's version go. */
async function forward(report: CrashReport): Promise<boolean> {
  try {
    const res = await fetch(upstreamUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report, server: serverVersion() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sends the reports this server kept before its operator chose to share. */
export async function forwardKeptCrashes(admin: SupabaseClient): Promise<void> {
  const { data } = await admin
    .from("app_feedback")
    .select("id, report")
    .eq("source", "crash")
    .is("forwarded_at", null)
    .order("created_at", { ascending: false })
    .limit(BACKLOG_MAX);
  for (const row of (data ?? []) as Pick<CrashRow, "id" | "report">[]) {
    if (row.report && (await forward(row.report))) {
      await admin.from("app_feedback").update({ forwarded_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
}

async function countSince(
  admin: SupabaseClient,
  filter: { source: string; userId?: string; withIssue?: boolean }
): Promise<number> {
  let q = admin
    .from("app_feedback")
    .select("id", { count: "exact", head: true })
    .like("source", filter.source)
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (filter.userId) q = q.eq("user_id", filter.userId);
  if (filter.withIssue) q = q.not("issue_url", "is", null);
  const { count } = await q;
  return count ?? 0;
}

/** The issue's number from its URL, for editing it. */
export function issueNumber(url: string): number | null {
  const m = /\/issues\/(\d+)$/.exec(url);
  return m ? Number(m[1]) : null;
}

async function editIssueBody(url: string, body: string): Promise<void> {
  const gh = feedbackGithub();
  const n = issueNumber(url);
  if (!gh || !n) return;
  await fetch(`https://api.github.com/repos/${gh.repo}/issues/${n}`, {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${gh.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
}

/** The inbox row's text: the issue title, then the report. */
export function crashMessage(report: CrashReport): string {
  return [crashIssueTitle(report), ...crashReportLines(report).slice(1).map((l) => `${l.label} ${l.value}`)].join("\n");
}

/**
 * Takes one report, from this server's own apps (`userId`) or, on the hosted
 * server, from a self-hosted server (`upstream`, with that server's version).
 */
export async function receiveCrash(
  admin: SupabaseClient,
  report: CrashReport,
  from: { userId: string } | { upstream: string | null }
): Promise<CrashReceipt> {
  const upstream = "upstream" in from;
  const { sharing } = await crashSharing();
  const to: CrashReceipt["to"] = sharing === "hosted" || sharing === "share" ? "team" : "admin";

  const daily = upstream
    ? (await countSince(admin, { source: "crash-upstream" })) >= CRASH_UPSTREAM_DAILY_MAX
    : (await countSince(admin, { source: "crash", userId: from.userId })) >= CRASH_USER_DAILY_MAX;

  const { data: existing } = await admin
    .from("app_feedback")
    .select("id, seen_count, issue_url, report, forwarded_at")
    .eq("signature", report.signature)
    .like("source", "crash%")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const version = upstream ? from.upstream : serverVersion();

  if (existing) {
    const row = existing as CrashRow;
    const seen = (row.seen_count ?? 1) + 1;
    await admin
      .from("app_feedback")
      .update({ seen_count: seen, last_seen_at: new Date().toISOString() })
      .eq("id", row.id);
    if (isCrashCountMilestone(seen)) {
      if (row.issue_url && sharing === "hosted") {
        await editIssueBody(row.issue_url, crashIssueBody(report, { seen, serverVersion: version, selfHosted: upstream }));
      } else if (sharing === "share") {
        await forward(report);
      }
    }
    return { result: "seen", to };
  }

  if (daily) return { result: "limited", to };

  const { data: inserted, error } = await admin
    .from("app_feedback")
    .insert({
      user_id: upstream ? null : from.userId,
      group_id: null,
      source: upstream ? "crash-upstream" : "crash",
      message: crashMessage(report),
      server_version: version,
      signature: report.signature,
      report,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "Crash report not saved");
  const id = (inserted as { id: string }).id;

  const gh = feedbackGithub();
  if (gh) {
    const cap = upstream ? CRASH_UPSTREAM_ISSUES_DAILY_MAX : CRASH_ISSUES_DAILY_MAX;
    const opened = await countSince(admin, { source: upstream ? "crash-upstream" : "crash", withIssue: true });
    if (opened < cap) {
      const url = await openIssue(
        gh,
        crashIssueTitle(report),
        crashIssueBody(report, { seen: 1, serverVersion: version, selfHosted: upstream }),
        upstream ? ["crash", "self-hosted"] : ["crash"]
      );
      if (url) await admin.from("app_feedback").update({ issue_url: url }).eq("id", id);
    }
  } else if (sharing === "share" && (await forward(report))) {
    await admin.from("app_feedback").update({ forwarded_at: new Date().toISOString() }).eq("id", id);
  }
  return { result: "new", to };
}
