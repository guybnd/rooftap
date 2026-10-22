import { describe, expect, it } from "vitest";
import { MODULE_FEATURES } from "@homeup/core";
import MARKS from "./screen-marks.json";
import { MAP_LINKS, MAP_MODULES, PAIR_FEATURES } from "./module-map-data";

const pair = (a: string, b: string) => [a, b].sort().join("|");

describe("landing module map", () => {
  it("draws a line for every two-module feature in core", () => {
    const drawn = new Set(MAP_LINKS.flatMap((l) => l.features));
    const missing = PAIR_FEATURES.filter((id) => !drawn.has(id));
    expect(missing).toEqual([]);
  });

  it("puts each feature on the line between its own two modules", () => {
    for (const link of MAP_LINKS) {
      for (const id of link.features) {
        expect([id, pair(...(MODULE_FEATURES[id].modules as [string, string]))]).toEqual([id, pair(link.a, link.b)]);
      }
    }
  });

  it("draws each pair once, between modules on the map", () => {
    const pairs = MAP_LINKS.map((l) => pair(l.a, l.b));
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const l of MAP_LINKS) expect(MAP_MODULES).toEqual(expect.arrayContaining([l.a, l.b]));
  });

  it("shows a real screen for every link", () => {
    expect(MAP_LINKS.filter((l) => !l.shots?.length).map((l) => `${l.a}|${l.b}`)).toEqual([]);
  });

  it("crops only to measured marks", () => {
    const marks = MARKS as Record<string, Record<string, unknown>>;
    for (const l of MAP_LINKS) for (const s of l.shots ?? []) expect([s.scene, s.mark, !!marks[s.scene]?.[s.mark]]).toEqual([s.scene, s.mark, true]);
  });
});
