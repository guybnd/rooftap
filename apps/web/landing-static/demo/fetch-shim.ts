// window.fetch for the screen demo: the API routes the pages call, answered
// from the fixtures. Anything else gets an empty 200.
import { chat, decide, getConversation, listConversations, updateConversation } from "./assistant-demo";
import {
  homeAssistantStatus,
  homeAssistantTools,
  scoutPicks,
  scoutSearch,
  assistantSettings,
  assistantStatus,
  assistantTelegram,
  assistantUsage,
  at,
  SATURDAY,
  googleEvents,
  shopperDeals,
  shopperSources,
} from "./fixtures";

type Answer = (url: URL, init?: RequestInit) => unknown;

const hour = new Date();
hour.setMinutes(0, 0, 0);
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:00`;
const ahead = Array.from({ length: 12 }, (_, i) => new Date(hour.getTime() + i * 3_600_000));
// Clear now, rain from two hours on.
const rainFrom = 2;

const weather = {
  tempC: 18,
  weatherCode: 1,
  highC: 21,
  lowC: 11,
  humidity: 62,
  windSpeedKmh: 14,
  sunset: localIso(new Date(hour.getFullYear(), hour.getMonth(), hour.getDate(), 19, 0)).replace("T19:00", "T19:12"),
  uvIndexMax: 6,
  hourly: {
    times: Array.from({ length: 24 }, (_, h) => localIso(new Date(hour.getFullYear(), hour.getMonth(), hour.getDate(), h))),
    precipitation: Array.from({ length: 24 }, (_, h) => (h >= hour.getHours() + rainFrom && h < hour.getHours() + rainFrom + 4 ? 1.2 : 0)),
    precipitationProbability: Array.from({ length: 24 }, (_, h) => (h >= hour.getHours() + rainFrom && h < hour.getHours() + rainFrom + 4 ? 80 : 10)),
    uvIndex: Array.from({ length: 24 }, (_, h) => Math.max(0, 6 - Math.abs(h - 13))),
  },
  ahead: {
    times: ahead.map(localIso),
    tempC: ahead.map((_, i) => Math.round(18 + 3 * Math.sin((i - 2) / 4))),
    precipitationProbability: ahead.map((_, i) => (i >= rainFrom && i < rainFrom + 4 ? 80 : 10)),
  },
};

/** Straight lines between the stops, a third longer for the streets, at each mode's pace. */
function directions(url: URL) {
  const points = (url.searchParams.get("coordinates") ?? "").split(";").map((p) => p.split(",").map(Number) as [number, number]);
  const speed = { walking: 1.3, cycling: 4.5, driving: 8 }[url.searchParams.get("profile") ?? "driving"] ?? 8;
  const metres = ([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) => {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(a)) * 1.3;
  };
  const legs = points.slice(1).map((to, i) => {
    const distance = metres(points[i], to);
    return { distance, duration: distance / speed, geometry: { type: "LineString", coordinates: [points[i], to] } };
  });
  return {
    geometry: { type: "LineString", coordinates: points },
    legs,
    totalDistance: legs.reduce((n, l) => n + l.distance, 0),
    totalDuration: legs.reduce((n, l) => n + l.duration, 0),
  };
}

const answers: [RegExp, Answer][] = [
  [/^\/api\/directions/, directions],
  [/^\/api\/weather/, () => weather],
  [/^\/api\/calendar\/status/, () => ({ connected: true, settings: { selected_calendar_ids: ["primary"], suggest_mode: "both", dedicated_calendar_id: null, keywords: [], pull_enabled: true, push_todos_enabled: true } })],
  [/^\/api\/calendar\/calendars/, () => ({ calendars: [{ id: "primary", summary: "ava@example.com", primary: true, selected: true }, { id: "family", summary: "Family", selected: true }] })],
  [/^\/api\/calendar\/events/, () => ({ events: googleEvents })],
  [/^\/api\/event-travel/, () => ({ minutes: 28 })],
  [/^\/api\/event-forecast/, () => ({ tempC: 18, weatherCode: 2, precipitationProbability: 40, summary: "Partly cloudy" })],
  [
    /^\/api\/parse-event/,
    () => ({
      title: "Jazz at the Lighthouse",
      starts_at: at(SATURDAY, "19:00"),
      ends_at: at(SATURDAY, "22:00"),
      location: "Lighthouse Bar, 12 Harbour Rd",
      category: "social",
      cost_cents: 5600,
      notes: "Two tickets.",
    }),
  ],
  [/^\/api\/public-config/, () => ({ modules: null })],
  // Shopper: prices are already in the stores; a check finds what is there.
  [/^\/api\/shopper\/sources/, () => ({ sources: shopperSources })],
  [/^\/api\/shopper\/deals/, (url) => ({ deals: url.searchParams.get("wantId") === "w-vacuum" ? shopperDeals : [] })],
  [/^\/api\/shopper\/scout\/scout-tv/, () => ({ search: scoutSearch, picks: scoutPicks })],
  [/^\/api\/shopper\/lookup/, () => ({ offers: 5, sources: ["serpapi-google-shopping"], failed: [] })],
  // Assistant.
  [/^\/api\/assistant\/status/, () => assistantStatus],
  [/^\/api\/assistant\/conversations\/[^/]+\/read/, () => ({ ok: true })],
  [
    /^\/api\/assistant\/conversations\/./,
    (url, init) => {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return init?.method === "PATCH" ? updateConversation(id, JSON.parse(String(init.body ?? "{}"))) : getConversation(id);
    },
  ],
  // The live demo has no model: assistant-demo matches a message to a scenario.
  [/^\/api\/assistant\/chat/, (_url, init) => chat(JSON.parse(String(init?.body ?? "{}")))],
  [
    /^\/api\/assistant\/proposals\/./,
    (url, init) => decide(decodeURIComponent(url.pathname.split("/").pop() ?? ""), JSON.parse(String(init?.body ?? "{}")).decision),
  ],
  [/^\/api\/assistant\/home-assistant/, (_url, init) => (init?.method === "POST" ? { tools: homeAssistantTools } : homeAssistantStatus)],
  [/^\/api\/assistant\/conversations/, () => listConversations()],
  [/^\/api\/assistant\/settings/, () => ({ settings: assistantSettings, isOwner: true })],
  [/^\/api\/assistant\/usage/, () => assistantUsage],
  [/^\/api\/assistant\/memories/, () => ({ memories: [{ id: "mem-1", text: "Noa is vegetarian", source: "agent", created_at: at(-20, "19:00") }, { id: "mem-2", text: "We shop at FreshCo on Saturdays", source: "manual", created_at: at(-14, "10:00") }] })],
  [/^\/api\/assistant\/telegram/, () => assistantTelegram],
  // Settings > Integrations & keys: the household's own Gemini key; the server's keys are the operator's, not the demo's.
  [/^\/api\/ai-keys/, () => ({ keys: [{ provider: "gemini", last4: "9fQe", createdAt: at(-30, "10:00") }], access: "unlimited", used: 0, allowance: null, isOwner: true, canStore: true })],
  [/^\/api\/admin\//, () => new Response(JSON.stringify({ error: "Only the server's operator sees this." }), { status: 403 })],
  [/^\/api\/pat/, () => ({ active: false })],
  [/^\/api\/oauth\/connections/, () => ({ connections: [] })],
];

export function installFetchShim() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const hit = answers.find(([re]) => re.test(url.pathname + url.search));
    // A beat before a reply, so the Assistant is seen thinking.
    if (url.pathname === "/api/assistant/chat") await new Promise((r) => setTimeout(r, 900));
    try {
      const body = hit ? hit[1](url, init) : {};
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Not in the demo." }), { status: 404, headers: { "content-type": "application/json" } });
    }
  };
}
