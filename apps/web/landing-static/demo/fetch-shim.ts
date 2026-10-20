// window.fetch for the screen demo: the API routes the pages call, answered
// from the fixtures. Anything else gets an empty 200.
import { at, SATURDAY, googleEvents } from "./fixtures";

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
