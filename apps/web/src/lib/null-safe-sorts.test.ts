// Sorts over row fields go through compareStrings (packages/core/src/sort.ts).
// A synced row can reach a screen with a string field missing (a row still
// syncing, a tombstone, an old cache), and a raw `a.title.localeCompare(...)`
// inside a render-time sort then throws and takes the whole screen down
// (HOUP-299, HOUP-300, the checklist crash, the Occasions crash of 2026-11-20).
// This test fails on `<row>.<field>.localeCompare(`. Compare with
// compareStrings(a.x, b.x), or guard both sides first: (a.x ?? '').localeCompare(b.x ?? '').
// A bare local (`ka.localeCompare(kb)`) is fine when the code above it has
// already made sure it is a string.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

const RAW_FIELD_COMPARE = /\.[A-Za-z_$][\w$]*!?\.localeCompare\(/g;

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'apps/web/src', 'apps/mobile/src', 'packages/core/src', 'packages/ui/src'], { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
}

describe('string sorts are null-safe', () => {
  it('never calls localeCompare straight on a row field', () => {
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      readFileSync(path.join(repoRoot, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (RAW_FIELD_COMPARE.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
          RAW_FIELD_COMPARE.lastIndex = 0;
        });
    }
    expect(hits, 'Use compareStrings(a.x, b.x) from @homeup/core').toEqual([]);
  });
});
