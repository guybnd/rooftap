// window.fetch for the screen demo: the API routes the pages call, answered
// from the fixtures. Anything else gets an empty 200.
import {
  assistantConversations,
  assistantMessages,
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

const answers: [RegExp, Answer][] = [
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
  [
    /^\/api\/assistant\/conversations\/./,
    (url) => {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const conversation = assistantConversations.find((c) => c.id === id) ?? assistantConversations[0];
      return { conversation, messages: assistantMessages[conversation.id] ?? [] };
    },
  ],
  // The live demo has no model: a message gets one fixed reply.
  [
    /^\/api\/assistant\/chat/,
    (_url, init) => {
      const input = JSON.parse(String(init?.body ?? "{}")) as { text?: string; conversationId?: string | null; kind?: "quick" | "chat" | "household" };
      const conversation = assistantConversations.find((c) => c.id === input.conversationId) ?? { ...assistantConversations[0], id: `conv-demo-${Date.now()}`, kind: input.kind ?? "quick", title: input.text?.slice(0, 40) ?? null, pending: 0 };
      const stamp = new Date().toISOString();
      return {
        conversation,
        messages: [
          { id: `demo-u-${stamp}`, role: "user", content: input.text ?? "", author: "Ava", channel: "app", created_at: stamp, proposal: null, cost_micros: null },
          { id: `demo-a-${stamp}`, role: "assistant", content: "This demo has no model behind it. On your own server, the Assistant answers here with the model you pick.", author: null, channel: "app", created_at: stamp, proposal: null, cost_micros: null },
        ],
        budget: "ok",
      };
    },
  ],
  [/^\/api\/assistant\/home-assistant/, (_url, init) => (init?.method === "POST" ? { tools: homeAssistantTools } : homeAssistantStatus)],
  [/^\/api\/assistant\/conversations/, () => ({ conversations: assistantConversations })],
  [/^\/api\/assistant\/settings/, () => ({ settings: assistantSettings, isOwner: true })],
  [/^\/api\/assistant\/usage/, () => assistantUsage],
  [/^\/api\/assistant\/memories/, () => ({ memories: [{ id: "mem-1", text: "Noa is vegetarian", source: "agent", created_at: at(-20, "19:00") }, { id: "mem-2", text: "We shop at FreshCo on Saturdays", source: "manual", created_at: at(-14, "10:00") }] })],
  [/^\/api\/assistant\/telegram/, () => assistantTelegram],
];

export function installFetchShim() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const hit = answers.find(([re]) => re.test(url.pathname + url.search));
    const body = hit ? hit[1](url, init) : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}
