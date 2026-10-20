// Issue a Personal Access Token for a Rooftap user (external-agent MCP read access).
// Run: node scripts/issue-pat.mjs <user-id> <label>
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const [userId, label] = process.argv.slice(2);

if (!userId || !label) {
  console.error("Usage: node scripts/issue-pat.mjs <user-id> <label>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const raw = `houp_pat_${randomBytes(32).toString("hex")}`;
const tokenHash = createHash("sha256").update(raw).digest("hex");

const { error } = await admin.from("personal_access_tokens").insert({
  user_id: userId,
  token_hash: tokenHash,
  label,
});

if (error) {
  console.error("Failed to issue token:", error.message);
  process.exit(1);
}

console.log("Personal access token issued. This is shown once only — store it now:");
console.log(raw);
