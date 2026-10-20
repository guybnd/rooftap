// Seed a disposable dev/test account + group so development never touches
// personal household data (data isolation is group-scoped RLS, so a separate
// group is a hard wall).
//
// Usage:
//   node scripts/seed-test-account.mjs
// Optional overrides: TEST_EMAIL (default dev@homeup.test), TEST_PASSWORD.
//
// Idempotent: re-running reuses the existing user/group and skips sample data
// if the group already has tasks. Never prints the password.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const EMAIL = process.env.TEST_EMAIL || 'dev@homeup.test';
// Throwaway dev-only credential (Guy's call, 2026-08-01) — real accounts never
// belong in the repo.
const PASSWORD = process.env.TEST_PASSWORD || 'devtester';
const GROUP_NAME = 'Dev Test Household';

// Parse root .env.local without a dotenv dependency.
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('.env.local is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// ── 1. User ──────────────────────────────────────────────────────────────────
let userId;
{
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 500 });
  if (error) throw error;
  const existing = data.users.find((u) => u.email === EMAIL);
  if (existing) {
    userId = existing.id;
    // Keep the account's password in sync with the script so a rotated
    // hardcoded default takes effect on re-run.
    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: PASSWORD });
    if (pwErr) throw pwErr;
    console.log(`User ${EMAIL} already exists (${userId}) — password synced to script value.`);
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Dev Tester' },
    });
    if (createErr) throw createErr;
    userId = created.user.id;
    console.log(`Created user ${EMAIL} (${userId}).`);
  }
}

// ── 2. Group + membership ────────────────────────────────────────────────────
let groupId;
{
  const { data: groups, error } = await admin.from('groups').select('id').eq('name', GROUP_NAME).eq('created_by', userId);
  if (error) throw error;
  if (groups.length > 0) {
    groupId = groups[0].id;
    console.log(`Group "${GROUP_NAME}" already exists (${groupId}).`);
  } else {
    const { data: g, error: gErr } = await admin.from('groups').insert({ name: GROUP_NAME, created_by: userId }).select('id').single();
    if (gErr) throw gErr;
    groupId = g.id;
    console.log(`Created group "${GROUP_NAME}" (${groupId}).`);
  }
  const { error: mErr } = await admin.from('group_members').upsert({ group_id: groupId, user_id: userId, role: 'owner' });
  if (mErr) throw mErr;
}

// ── 3. Sample data (only into an empty group) ────────────────────────────────
const { count } = await admin.from('household_tasks').select('id', { count: 'exact', head: true }).eq('group_id', groupId);
if (count > 0) {
  console.log(`Group already has ${count} tasks — skipping sample data.`);
} else {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  // household_tasks has no created_by column; grocery_items/cost_items do.
  const base = { group_id: groupId, created_at: now, updated_at: now, deleted: false };
  const authored = { ...base, created_by: userId };

  const { error: tErr } = await admin.from('household_tasks').insert([
    { id: randomUUID(), ...base, title: 'Water the plants', due_date: today, done: false, private: false, sort_order: 0 },
    { id: randomUUID(), ...base, title: 'Take out recycling', due_date: today, done: false, private: false, sort_order: 1, priority: 'high' },
    { id: randomUUID(), ...base, title: 'Book dentist appointment', due_date: null, done: false, private: false, sort_order: 2 },
  ]);
  if (tErr) throw tErr;

  const { error: gErr } = await admin.from('grocery_items').insert([
    { id: randomUUID(), ...authored, name: 'Milk', aisle: 'Dairy', status: 'needed', private: false, sort_order: 0 },
    { id: randomUUID(), ...authored, name: 'Bread', aisle: 'Bakery', status: 'needed', private: false, sort_order: 1 },
    { id: randomUUID(), ...authored, name: 'Apples', aisle: 'Produce', status: 'have', private: false, sort_order: 2 },
  ]);
  if (gErr) throw gErr;

  const { error: cErr } = await admin.from('cost_items').insert([
    { id: randomUUID(), ...authored, name: 'Electricity', category: 'utilities', amount: 12000, cadence: 'monthly', is_estimate: true, sort_order: 0 },
    { id: randomUUID(), ...authored, name: 'Internet', category: 'internet', amount: 8000, cadence: 'monthly', is_estimate: false, sort_order: 1 },
  ]);
  if (cErr) throw cErr;

  console.log('Seeded 3 tasks, 3 groceries, 2 cost items.');
}

console.log(`\nDone. Log in on any surface with ${EMAIL} and the password you chose.`);
