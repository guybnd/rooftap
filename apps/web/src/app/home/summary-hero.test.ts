import { describe, expect, it } from "vitest";
import { ALL_MODULE_IDS, isFeatureEnabled, type ModuleFeatureId, type ModuleId } from "@homeup/core";
import { selectRenderedTips } from "./summary-hero";
import { HERO_MODULES, availableHeroModules, isModuleShown, type HeroModuleContext } from "./hero-modules";
import type { WeatherData } from "./use-weather";

// HOUP-14: integration test for the density-cap loop at summary-hero.tsx —
// exercises the real tips-group modules from hero-modules.tsx (registry
// order + real condition logic), not a reimplementation, so a regression to
// e.g. `.slice(0, 2)` on enabled modules would be caught here.

const DATE = "2026-07-23";
const NOON = new Date(`${DATE}T12:00:00`);

const TIP_MODULES = HERO_MODULES.filter((m) => m.group === "tips");

function hourlyTimes(): string[] {
  return Array.from({ length: 24 }, (_, h) => `${DATE}T${String(h).padStart(2, "0")}:00`);
}

function baseWeather(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    tempC: 20,
    weatherCode: 1,
    highC: 24,
    lowC: 14,
    ...overrides,
  };
}

function baseCtx(weather: WeatherData | null): HeroModuleContext {
  return {
    todayCount: 0,
    weather,
    todayItems: [],
    memberProfiles: {},
    currentUserId: null,
    tasks: [],
    now: NOON,
    budgetCents: null,
    costItems: [],
    groceryToBuyCount: 0,
    setup: { done: 0, total: 0 },
    countdown: null,
    shopperShortcut: null,
  };
}

describe("selectRenderedTips density cap (HOUP-14)", () => {
  it("all four tips qualify → only tipRain + tipUv render, in priority order", () => {
    const dryHourly = {
      times: hourlyTimes(),
      precipitation: hourlyTimes().map(() => 0),
      precipitationProbability: hourlyTimes().map(() => 0),
      uvIndex: hourlyTimes().map((_, h) => (h === 12 ? 8 : 0)),
    };
    // Qualifies tipRain (hot), tipUv (high UV at the current hour), tipDrying
    // (clear/dry/breezy/no rain forecast), and tipSunset (sunset present) all
    // at once.
    const weather = baseWeather({
      weatherCode: 1,
      tempC: 30,
      humidity: 45,
      windSpeedKmh: 15,
      sunset: `${DATE}T19:42`,
      hourly: dryHourly,
    });
    const ctx = baseCtx(weather);

    const result = selectRenderedTips(TIP_MODULES, ctx);

    expect(result.map((t) => t.key)).toEqual(["tipRain", "tipUv"]);
  });

  it("original-bug scenario: higher-priority tips don't qualify → a lower-priority qualifying tip is not starved", () => {
    const dryHourly = {
      times: hourlyTimes(),
      precipitation: hourlyTimes().map(() => 0),
      precipitationProbability: hourlyTimes().map(() => 0),
      uvIndex: hourlyTimes().map(() => 0),
    };
    // tipRain and tipUv do not qualify (mild temp/weather, low UV); tipDrying
    // does. A cap based on `.slice(0, 2)` of *enabled* modules would consume
    // the tipRain/tipUv slots and drop tipDrying entirely.
    const weather = baseWeather({
      weatherCode: 1,
      tempC: 20,
      humidity: 45,
      windSpeedKmh: 15,
      uvIndexMax: 2,
      hourly: dryHourly,
    });
    const ctx = baseCtx(weather);

    const result = selectRenderedTips(TIP_MODULES, ctx);

    expect(result.map((t) => t.key)).toEqual(["tipDrying"]);
  });

  it("caps at the given count even when more than `cap` modules qualify", () => {
    const modules = [
      { key: "a", render: () => "A" },
      { key: "b", render: () => "B" },
      { key: "c", render: () => "C" },
    ];
    const result = selectRenderedTips(modules, baseCtx(null), 2);
    expect(result.map((t) => t.key)).toEqual(["a", "b"]);
  });
});

// Modules (module-features.ts): a hero module showing another module's data
// is gone with that module, from the hero and from the customize sheet, even
// when the person's saved config has it on. Unrelated modules change nothing.
describe("hero modules behind a module", () => {
  const ALL_KEYS = HERO_MODULES.map((m) => m.key);
  const allOnConfig = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
  const featureWith = (enabled: ReadonlySet<string>) => (id: ModuleFeatureId) => isFeatureEnabled(id, enabled);

  const goneWithout: Partial<Record<ModuleId, string[]>> = {
    household: ["whosOnHook", "unassignedNudge", "streak"],
    costs: ["budgetPulse", "billsDue"],
    groceries: ["shoppingList"],
    setup: ["setupProgress"],
    shopper: ["shopperWatch"],
  };

  it("everything on lists and shows every module", () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS));
    expect(availableHeroModules(feature).map((m) => m.key)).toEqual(ALL_KEYS);
    expect(ALL_KEYS.filter((k) => isModuleShown(k, allOnConfig, feature))).toEqual(ALL_KEYS);
  });

  it.each(ALL_MODULE_IDS)("turning %s off removes only its modules, whatever the config says", (off) => {
    const feature = featureWith(new Set(ALL_MODULE_IDS.filter((m) => m !== off)));
    const expected = ALL_KEYS.filter((k) => !(goneWithout[off] ?? []).includes(k));
    expect(availableHeroModules(feature).map((m) => m.key)).toEqual(expected);
    expect(ALL_KEYS.filter((k) => isModuleShown(k, allOnConfig, feature))).toEqual(expected);
  });

  it("the person's own off toggle still hides a module whose feature is on", () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS));
    expect(isModuleShown("budgetPulse", { budgetPulse: false }, feature)).toBe(false);
  });
});
