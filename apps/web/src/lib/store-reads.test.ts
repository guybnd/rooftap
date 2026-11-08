// Screens read synced stores through useRows (packages/core/src/data/use-rows.ts).
// Reading `Object.values(store$.get())` by hand lets unreadable rows through
// (#386, #483, #547, #653, #661) and, inside use$, builds a new array every
// render, so effects that depend on it loop (#630, #671). This test fails on
// a new hand-written read.
//
// BASELINE holds the reads that were left when useRows arrived (2026-11-08),
// mostly ones that sort or use .find. It only shrinks: move a read to useRows
// (sort with useMemo on its result) and lower or delete the file's count.
// Reads outside render, in a callback, use readableRows(store$.peek()).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

const ALLOWED = new Set(['packages/core/src/data/use-rows.ts', 'packages/core/src/data/create-group-store.ts']);

const BASELINE: Record<string, number> = {
  'apps/mobile/src/app/(tabs)/checklists/index.tsx': 1,
  'apps/mobile/src/app/(tabs)/costs/index.tsx': 2,
  'apps/mobile/src/app/(tabs)/groceries/index.tsx': 1,
  'apps/mobile/src/app/(tabs)/shopper/index.tsx': 1,
  'apps/mobile/src/app/(tabs)/tasks/index.tsx': 1,
  'apps/mobile/src/app/checklists/[id].tsx': 1,
  'apps/mobile/src/app/checklists/new.tsx': 1,
  'apps/mobile/src/app/checklists/templates.tsx': 1,
  'apps/mobile/src/app/shopper/scout/archived.tsx': 1,
  'apps/mobile/src/features/calendar/document-calendar-flow.tsx': 1,
  'apps/mobile/src/features/homesearch/apartment-appointment.tsx': 2,
  'apps/mobile/src/features/homesearch/apartment-card.tsx': 1,
  'apps/mobile/src/features/homesearch/apartment-comments.tsx': 1,
  'apps/mobile/src/features/homesearch/checklist-scoring.tsx': 1,
  'apps/web/src/app/checklists/[id]/page.tsx': 1,
  'apps/web/src/app/checklists/new/page.tsx': 2,
  'apps/web/src/app/checklists/page.tsx': 1,
  'apps/web/src/app/checklists/templates/page.tsx': 2,
  'apps/web/src/app/costs/page.tsx': 1,
  'apps/web/src/app/groceries/page.tsx': 1,
  'apps/web/src/app/shopper/page.tsx': 1,
  'apps/web/src/app/shopper/scout/archived/page.tsx': 1,
  'apps/web/src/app/tasks/page.tsx': 1,
  'apps/web/src/app/~offline/page.tsx': 1,
  'apps/web/src/components/apartment-appointment.tsx': 1,
  'apps/web/src/components/apartment-comments.tsx': 1,
  'apps/web/src/components/capture/capture-sheet.tsx': 7,
  'apps/web/src/components/checklist-scoring.tsx': 1,
  'apps/web/src/components/documents/document-calendar-flow.tsx': 1,
  'packages/core/src/modules/home-care/use-care-jobs.ts': 1,
  'packages/core/src/modules/setup/use-setup-list.ts': 1,
  'packages/core/src/slots/rows.ts': 1,
};

const HAND_READ = /Object\.values\([A-Za-z0-9_.]*\$\.get\(\)/g;

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'apps/web/src', 'apps/mobile/src', 'packages/core/src', 'packages/ui/src'], { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !ALLOWED.has(f));
}

describe('store reads go through useRows', () => {
  const counts = new Map<string, number>();
  for (const file of sourceFiles()) {
    const n = (readFileSync(path.join(repoRoot, file), 'utf8').match(HAND_READ) ?? []).length;
    if (n > 0) counts.set(file, n);
  }

  it('adds no new hand-written store read', () => {
    const over = [...counts].filter(([file, n]) => n > (BASELINE[file] ?? 0)).map(([file, n]) => `${file}: ${n} (baseline ${BASELINE[file] ?? 0})`);
    expect(over, 'Read the store with useRows from @homeup/core instead').toEqual([]);
  });

  it('keeps the baseline as small as the code', () => {
    const stale = Object.entries(BASELINE)
      .filter(([file, n]) => (counts.get(file) ?? 0) < n)
      .map(([file, n]) => `${file}: now ${counts.get(file) ?? 0}, baseline ${n}`);
    expect(stale, 'Lower or delete these BASELINE entries').toEqual([]);
  });
});
