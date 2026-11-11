// Deleting an account must never take a shared household's things with it.
//
// The auth admin delete cascades through every column that references
// auth.users with `on delete cascade`. prepare_account_deletion (in the
// migrations) runs first and hands each shared household's rows to the
// household's next owner. So every such column is either handed over there,
// or listed below as the person's own (their comments, settings, tokens),
// which may go with them. A new cascading column fails here until someone
// decides which. Lives in apps/web because core can't use Node's fs.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(__dirname, "../../../../supabase/migrations");

/** Rows that belong to the person, not the household: they go with the account. */
const PERSONAL = new Set([
  "apartment_comments.user_id",
  "apartment_preliminary_scores.user_id",
  "app_feedback.user_id",
  "assistant_conversations.owner_id", // private chats only; household chats have no owner
  "assistant_member_limits.user_id",
  "assistant_memories.owner_id", // private notes only
  "assistant_notify_prefs.user_id",
  "assistant_reads.user_id",
  "assistant_telegram_codes.user_id",
  "assistant_telegram_links.user_id",
  "bank_accounts.user_id",
  "bank_feed_settings.user_id",
  "bank_transactions.user_id",
  "cook_sessions.user_id",
  "cost_item_comments.user_id",
  "device_push_tokens.user_id",
  "email_lookup_hits.user_id",
  "event_leave_notices.user_id",
  "google_calendar_connections.user_id",
  "google_calendar_events.user_id",
  "google_calendar_pushed_events.user_id",
  "group_invitations.invited_by",
  "group_invitations.invited_user_id",
  "group_members.user_id",
  "household_task_comments.user_id",
  "oauth_authorization_codes.user_id",
  "oauth_tokens.user_id",
  "personal_access_tokens.user_id",
  "push_subscriptions.user_id",
  "setup_item_comments.user_id",
  "up_bank_connections.user_id",
  "user_settings.user_id",
  "warranty_asset_comments.user_id",
  "wishlist_items.user_id", // a person's own wish list
]);

// Line comments first: a "--" comment can hold a "/*" (such as "api/calendar/*").
const strip = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const DELETE_RULE = /on\s+delete\s+(cascade|set null|restrict|no action|set default)/i;

/** table.column -> its on-delete rule, for every column that references auth.users, after all migrations. */
function userColumns(files: { name: string; sql: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { sql } of files) {
    for (const stmt of strip(sql).split(";")) {
      const dropped = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(stmt);
      if (dropped) for (const key of [...out.keys()]) if (key.startsWith(`${dropped[1]}.`)) out.delete(key);
      const table =
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/i.exec(stmt)?.[1] ??
        /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?/i.exec(stmt)?.[1];
      if (!table) continue;
      const refs = [
        ...stmt.matchAll(/"?(\w+)"?\s+uuid\b[^,]*?references\s+auth\.users\b[^,]*/gi),
        ...stmt.matchAll(/foreign\s+key\s*\(\s*"?(\w+)"?\s*\)\s*references\s+auth\.users\b[^,]*/gi),
      ];
      for (const m of refs) out.set(`${table}.${m[1]}`, DELETE_RULE.exec(m[0])?.[1]?.toLowerCase() ?? "no action");
    }
  }
  return out;
}

/** table.column pairs prepare_account_deletion hands over, from its newest definition. */
function handedOver(files: { name: string; sql: string }[]): Set<string> {
  const latest = [...files].reverse().find((f) => /function\s+public\.prepare_account_deletion\s*\(/i.test(f.sql));
  if (!latest) return new Set();
  const body = latest.sql.slice(latest.sql.search(/function\s+public\.prepare_account_deletion\s*\(/i));
  const pairs = new Set<string>();
  for (const m of body.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)) pairs.add(`${m[1]}.${m[2]}`);
  for (const m of body.matchAll(/update\s+(\w+)\s+(?:\w+\s+)?set\s+(\w+)\s*=/gi)) pairs.add(`${m[1]}.${m[2]}`);
  return pairs;
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));

describe("account deletion", () => {
  const columns = userColumns(files);
  const handed = handedOver(files);

  it("reads the columns and the hand-over list", () => {
    expect(columns.get("groups.created_by")).toBe("cascade");
    expect(handed.has("groups.created_by")).toBe(true);
    expect(handed.has("cost_items.created_by")).toBe(true);
  });

  it("hands over or names as personal every column an account delete would cascade or block", () => {
    const loose = [...columns]
      .filter(([, rule]) => rule === "cascade" || rule === "no action" || rule === "restrict")
      .map(([key]) => key)
      .filter((key) => !handed.has(key) && !PERSONAL.has(key));
    expect(loose, "add each to prepare_account_deletion's hand-over list, or to PERSONAL here").toEqual([]);
  });

  it("keeps PERSONAL free of columns that are gone or handed over", () => {
    for (const key of PERSONAL) {
      expect(columns.has(key), `${key} no longer references auth.users`).toBe(true);
      expect(handed.has(key), `${key} is handed over, so it is not personal`).toBe(false);
    }
  });
});
