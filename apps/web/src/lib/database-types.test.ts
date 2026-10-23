import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// packages/core/src/database.types.ts (and the store checks in
// schema-check.ts that read it) only mean something while it was built from
// every migration. Its header names the newest one; a migration added after
// it fails here until someone runs `npm run db:types` (see
// scripts/db-types.mjs). Lives in apps/web because core can't use Node's fs.
const repoRoot = path.resolve(__dirname, '../../../..');

describe('database.types.ts', () => {
  it('was generated from the newest migration', () => {
    const latest = readdirSync(path.join(repoRoot, 'supabase/migrations'))
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort()
      .at(-1)!
      .split('_')[0];
    const header = readFileSync(path.join(repoRoot, 'packages/core/src/database.types.ts'), 'utf8').split('\n').slice(0, 3).join('\n');
    const built = /up to (\d+)\./.exec(header)?.[1];
    expect(built, 'database.types.ts is behind supabase/migrations: run `npm run db:types`').toBe(latest);
  });
});
