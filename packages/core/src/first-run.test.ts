import { describe, expect, it } from 'vitest';
import { MODULES, getModule, resolveEnabledModules, type ModuleId } from './modules';
import { STARTING_SETS, sameModuleSet, sampleHomeHref, startingSetModules } from './first-run';

const defaults = resolveEnabledModules({ available: null, rows: [] });

describe('starting sets', () => {
  it('Everyday is the defaults', () => {
    expect(sameModuleSet(startingSetModules('everyday', MODULES, defaults), defaults)).toBe(true);
  });

  it('Moving house adds the search and the new place to Everyday', () => {
    const moving = startingSetModules('moving', MODULES, defaults);
    for (const id of defaults) expect(moving.has(id)).toBe(true);
    expect(moving.has('search')).toBe(true);
    expect(moving.has('setup')).toBe(true);
    expect(moving.has('home-care')).toBe(true);
  });

  it('Everything ticks every tile but the integrations that need connecting', () => {
    const all = startingSetModules('everything', MODULES, defaults);
    expect(all.has('google-calendar')).toBe(false);
    expect(all.has('mcp')).toBe(false);
    for (const m of MODULES) if (m.id !== 'google-calendar' && m.id !== 'mcp') expect(all.has(m.id)).toBe(true);
  });

  it('never ticks a module without what it needs, or one the server does not offer', () => {
    const offered = MODULES.filter((m) => m.id !== 'setup');
    const moving = startingSetModules('moving', offered, defaults);
    expect(moving.has('setup')).toBe(false);
    for (const set of STARTING_SETS) {
      const chosen = startingSetModules(set.id, MODULES, defaults);
      for (const id of chosen) for (const r of getModule(id)?.requires ?? []) expect(chosen.has(r as ModuleId)).toBe(true);
    }
  });

  it('every module says what it does for the others', () => {
    for (const m of MODULES) expect(m.feeds, m.id).toBeTruthy();
  });

  it('the sample home link carries the way back', () => {
    expect(sampleHomeHref()).not.toContain('back=');
    expect(sampleHomeHref('https://example.com/home')).toContain('&back=https%3A%2F%2Fexample.com%2Fhome');
  });
});
