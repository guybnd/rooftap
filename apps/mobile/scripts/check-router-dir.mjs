#!/usr/bin/env node
// Guards the regression that #186 shipped and #193 cleaned up.
//
// Expo Router builds its route table with `require.context` over the app
// directory, and its matcher globs every .ts/.tsx beneath it:
//
//   /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.ios|\.web)?\.[tj]sx?$/
//
// There is no `.test.` exclusion. A test file left under src/app is therefore
// pulled into the *native* module graph, dragging `vitest` -> `vite/module-runner`
// in with it, and Metro's transform dies on that module's dynamic
// `import(filepath)`. Every `expo run:android` build fails at the bundle step.
//
// Nothing else catches this: vitest happily runs the file wherever it lives,
// tsc is fine with it, and the web build never walks the router graph. Only a
// native bundle surfaces it -- which is exactly the build a reviewer is least
// likely to run. Hence this check.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const OFFENDING = /\.(test|spec)\.[jt]sx?$/;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (OFFENDING.test(entry.name)) found.push(full);
  }
  return found;
}

let offenders = [];
try {
  offenders = walk(appDir);
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.error(`check-router-dir: expected an app directory at ${appDir}`);
    process.exit(1);
  }
  throw err;
}

if (offenders.length > 0) {
  const list = offenders.map((f) => `  ${relative(projectRoot, f).replace(/\\/g, '/')}`).join('\n');
  console.error(
    [
      '',
      'Test files found inside the expo-router app directory:',
      '',
      list,
      '',
      "Expo Router's require.context bundles every .ts/.tsx under src/app into the",
      "native graph -- it has no '.test.' exclusion -- so these drag vitest (and",
      'vite/module-runner) into the Metro bundle and break `expo run:android` with:',
      '',
      '  SyntaxError: vite/dist/node/module-runner.js:',
      '  Invalid call at line 1013: import(filepath)',
      '',
      'Move each test beside its subject outside the routes tree, e.g.',
      'src/features/<area>/ or src/lib/ (see src/features/tasks/task-sort.test.ts).',
      '',
    ].join('\n')
  );
  process.exit(1);
}
