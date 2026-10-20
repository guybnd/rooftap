// Deno twin of packages/core/src/event-forecast.ts for the reminder push
// (notify-upcoming-events): the forecast text for an event's day. Pure and
// import-free; core's event-forecast.test.ts checks the two agree.

export function openMeteoEventForecastUrl(lat: number, lng: number, date: string): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    start_date: date,
    end_date: date,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function weatherLabel(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "showers";
  if (code <= 86) return "snow showers";
  if (code <= 99) return "thunderstorm";
  return "cloudy";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The forecast text for the event's hour (or day, when `hour` is null), or null when the answer is incomplete. */
export function eventForecastTextFrom(raw: unknown, hour: number | null): string | null {
  const r = raw as {
    hourly?: Record<string, unknown[] | undefined>;
    daily?: Record<string, unknown[] | undefined>;
  } | null;
  const highC = num(r?.daily?.temperature_2m_max?.[0]);
  const lowC = num(r?.daily?.temperature_2m_min?.[0]);
  const dayCode = num(r?.daily?.weather_code?.[0]);
  if (highC === null || lowC === null || dayCode === null) return null;
  let tempC: number | null = null;
  let code = dayCode;
  let rain = num(r?.daily?.precipitation_probability_max?.[0]);
  if (hour !== null) {
    const hourTemp = num(r?.hourly?.temperature_2m?.[hour]);
    const hourCode = num(r?.hourly?.weather_code?.[hour]);
    if (hourTemp !== null && hourCode !== null) {
      tempC = hourTemp;
      code = hourCode;
      rain = num(r?.hourly?.precipitation_probability?.[hour]);
    }
  }
  const temp = tempC !== null ? `${Math.round(tempC)}°` : `${Math.round(lowC)} to ${Math.round(highC)}°`;
  const rainText = rain !== null && rain >= 30 ? `, ${Math.round(rain)}% chance of rain` : "";
  return `${temp}, ${weatherLabel(code)}${rainText}`;
}
