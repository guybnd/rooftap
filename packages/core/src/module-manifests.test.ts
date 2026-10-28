import { describe, expect, it } from 'vitest';
import { ALL_MANIFESTS } from './module-manifests';

// Every module folder has a manifest listed in module-manifests.ts under its
// own id: the module-boundary lint (scripts/check-module-boundary.mjs) checks
// that, since core's tests can't read the file system.

describe('module manifests', () => {
  it('give every section its own hue and base path', () => {
    const withSection = ALL_MANIFESTS.filter((m) => m.section);
    const hues = withSection.map((m) => m.section!.hue);
    expect(hues.filter((h, i) => hues.indexOf(h) !== i), 'hues two sections wear').toEqual([]);
    const bases = withSection.map((m) => m.section!.basePath);
    expect(bases.filter((b, i) => bases.indexOf(b) !== i), 'base paths two sections use').toEqual([]);
    expect(hues, 'Home wears coral').not.toContain('coral');
  });

  it('give each table one owner', () => {
    const tables = ALL_MANIFESTS.flatMap((m) => Object.keys(m.tables ?? {}));
    expect(tables.filter((t, i) => tables.indexOf(t) !== i)).toEqual([]);
  });

  it("sync each synced table while its own module is on", () => {
    const missing = ALL_MANIFESTS.flatMap((m) =>
      Object.entries(m.tables ?? {}).flatMap(([table, t]) => (t.sync && !t.sync.includes(m.id) ? [`${m.id}: ${table}`] : [])),
    );
    expect(missing).toEqual([]);
  });
});
