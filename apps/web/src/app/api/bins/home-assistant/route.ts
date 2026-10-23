import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModules } from "@/lib/server-modules";
import { decryptHouseholdKey } from "@/lib/ai/household-keys";
import { checkHomeAssistantHost, homeAssistantRow } from "@/lib/assistant/home-assistant";

// Bin night: read bin days from Home Assistant's Waste Collection Schedule
// add-on, which shows each council's collections as a calendar entity. Uses
// the household's Home Assistant connection (Settings > Assistant), so it
// needs Bin night and the Assistant (`bins.home-assistant`). Answers the
// collection dates; the setup sheet works the pattern out from them with
// core's inferBinSetup and the person checks it before anything is saved.
//
// POST {} reads every calendar that looks like a bin calendar; POST
// { entityId } reads that one. Both list the calendars Home Assistant has,
// so the sheet can offer another when none matched.

const HA_TIMEOUT_MS = 8_000;
const WEEKS_AHEAD = 16;
const BIN_CALENDAR = /waste|bin|rubbish|garbage|recycl|collection|refuse|trash|abfall/i;

interface HaCalendar {
  entity_id: string;
  name?: string;
}

interface HaEvent {
  summary?: string;
  start?: { date?: string; dateTime?: string };
}

async function haGet<T>(base: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(HA_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Home Assistant refused the saved token. Paste it again in Settings > Assistant.");
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}.`);
  return (await res.json()) as T;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // `bins.home-assistant` (module-features.ts): Bin night and the Assistant.
  const off = await requireModules(user.id, "bins", "assistant");
  if (off) return off;
  const admin = createAdminClient();
  const { data: membership } = await admin.from("group_members").select("group_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await homeAssistantRow(admin, membership.group_id);
  if (!row) return NextResponse.json({ error: "Connect Home Assistant first, in Settings > Assistant." }, { status: 409 });
  const token = decryptHouseholdKey(row.encrypted_token);
  if (!token) return NextResponse.json({ error: "The saved Home Assistant token can't be read on this server. Paste it again in Settings > Assistant." }, { status: 409 });
  const refused = await checkHomeAssistantHost(row.url);
  if (refused) return NextResponse.json({ error: refused }, { status: 422 });

  const body = ((await request.json().catch(() => null)) ?? {}) as { entityId?: unknown };
  const base = row.url.replace(/\/+$/, "");
  try {
    const all = await haGet<HaCalendar[]>(base, token, "/api/calendars");
    const calendars = (Array.isArray(all) ? all : [])
      .filter((c) => typeof c?.entity_id === "string" && c.entity_id.startsWith("calendar."))
      .map((c) => ({ entityId: c.entity_id, name: c.name || c.entity_id }));
    const wanted =
      typeof body.entityId === "string"
        ? calendars.filter((c) => c.entityId === body.entityId)
        : calendars.filter((c) => BIN_CALENDAR.test(c.entityId) || BIN_CALENDAR.test(c.name));

    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date(start.getTime() + WEEKS_AHEAD * 7 * 86_400_000);
    const collections: { date: string; name: string }[] = [];
    for (const cal of wanted.slice(0, 4)) {
      const events = await haGet<HaEvent[]>(
        base,
        token,
        `/api/calendars/${encodeURIComponent(cal.entityId)}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
      );
      for (const ev of Array.isArray(events) ? events : []) {
        const date = (ev.start?.date ?? ev.start?.dateTime ?? "").slice(0, 10);
        const name = (ev.summary ?? "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && name) {
          // One event can name several bins: "General waste, Recycling".
          for (const part of name.split(/\s*(?:,|&|\+|\band\b)\s*/i)) if (part) collections.push({ date, name: part });
        }
      }
    }
    return NextResponse.json({ calendars, collections });
  } catch (err) {
    const message = err instanceof Error && err.name !== "TimeoutError" ? err.message : "Home Assistant didn't answer in time.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
