import type { SupabaseClient } from "@supabase/supabase-js";
import { FEEDBACK_MAX, type FeedbackItem } from "@homeup/core";
import { memberNames } from "@/lib/member-names";

// Feedback people send through the Assistant. It always lands in the server
// operator's inbox (app_feedback, Settings > Integrations & keys > Feedback).
// A server that names a GitHub repo and token also opens an issue there, so
// the people who build Rooftap see it where they work. Self-hosted servers
// leave both unset, so their feedback stays with their own operator.

/** How long GitHub has to answer before the feedback is kept without an issue. */
const GITHUB_TIMEOUT_MS = 6_000;

interface FeedbackRow {
  id: string;
  user_id: string | null;
  group_id: string | null;
  source: string;
  message: string;
  server_version: string | null;
  issue_url: string | null;
  done_at: string | null;
  created_at: string;
}

/** The repo ("owner/name") and token feedback issues go to, or null when either is unset. */
export function feedbackGithub(): { repo: string; token: string } | null {
  const repo = process.env.FEEDBACK_GITHUB_REPO?.trim();
  const token = process.env.FEEDBACK_GITHUB_TOKEN?.trim();
  if (!repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { repo, token };
}

function serverVersion(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.HOMEUP_SCHEMA_VERSION || null;
}

/** The issue's title: the first line of the message, cut to fit. */
export function feedbackIssueTitle(message: string): string {
  const line = message.trim().split("\n")[0].trim();
  return `Feedback: ${line.length > 70 ? `${line.slice(0, 69).trimEnd()}…` : line}`;
}

/** The issue's body: the message, then where it came from. Never a name, email or household data. */
export function feedbackIssueBody(message: string, meta: { version: string | null; id: string }): string {
  const from = ["Sent through the Assistant"];
  if (meta.version) from.push(`server ${meta.version}`);
  from.push(`feedback id ${meta.id}`);
  return `${message.trim()}\n\n---\n_${from.join(", ")}._`;
}

async function openIssue(gh: { repo: string; token: string }, title: string, body: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${gh.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels: ["feedback"] }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { html_url?: string };
    return data.html_url ?? null;
  } catch {
    return null;
  }
}

/** Saves feedback and, when the server is set up for it, opens a GitHub issue. */
export async function submitFeedback(
  admin: SupabaseClient,
  input: { userId: string; groupId: string | null; message: string }
): Promise<{ id: string; issueUrl: string | null }> {
  const message = input.message.trim().slice(0, FEEDBACK_MAX);
  if (!message) throw new Error("Feedback is empty");
  const version = serverVersion();
  const { data, error } = await admin
    .from("app_feedback")
    .insert({ user_id: input.userId, group_id: input.groupId, source: "assistant", message, server_version: version })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Feedback not saved");
  const id = (data as { id: string }).id;
  const gh = feedbackGithub();
  if (!gh) return { id, issueUrl: null };
  const issueUrl = await openIssue(gh, feedbackIssueTitle(message), feedbackIssueBody(message, { version, id }));
  if (issueUrl) await admin.from("app_feedback").update({ issue_url: issueUrl }).eq("id", id);
  return { id, issueUrl };
}

/** The operator's inbox, newest first, with each sender's first name. */
export async function listFeedback(admin: SupabaseClient, limit = 100): Promise<FeedbackItem[]> {
  const { data, error } = await admin.from("app_feedback").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FeedbackRow[];
  const groups = [...new Set(rows.map((r) => r.group_id).filter((g): g is string => !!g))];
  const names = new Map<string, string>();
  await Promise.all(
    groups.map(async (g) => {
      for (const [id, name] of await memberNames(admin, g).catch(() => new Map<string, string>())) names.set(id, name);
    })
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    from: (r.user_id && names.get(r.user_id)) || null,
    serverVersion: r.server_version,
    issueUrl: r.issue_url,
    done: !!r.done_at,
    createdAt: r.created_at,
  }));
}

/** Marks feedback dealt with, or back to new. */
export async function setFeedbackDone(admin: SupabaseClient, id: string, done: boolean): Promise<void> {
  const { error } = await admin
    .from("app_feedback")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
