#!/usr/bin/env node
// Scaffolds a new module the way every module should start (.docs/modules.md
// section 15):
//
//   npm run new-module -- <id> --label "Plant care" --icon sprout --hue "#3A8F5C" \
//     --description "Which plants need water, and when." [--short Plants] [--dry-run]
//
// It writes the module's core folder (view helpers, a view-model hook, a
// test), its synced store, thin web and phone screens that only bind core and
// render the shared line item with the shared row menu, the Assistant's
// tools, a migration with grants and RLS, and a What's new entry. The module's
// manifest (packages/core/src/modules/<id>/manifest.ts) declares its section,
// hue, synced table, tools and table reach, so the registries built from it
// (modules.ts, sections.ts, section hues, store-modules, MCP_TOOLS,
// TABLE_REACH, the web offline cache, the phone tab routes and both route
// tests) need no edit. It then lists the manifest in module-manifests.ts and
// adds the few entries that can't come from a manifest: core exports, the
// type check, the edge functions' module rules, the tool handlers and both
// icon maps. Each carries a "new-module:<slot>" marker comment; new lines go
// above it.
//
// The starter is a plain list. Reshape it into the module, keeping the split:
// apps/web/src/lib/module-conformance.test.ts fails on logic in a screen,
// a missing platform, or rows off the shared primitives.
//
// Plain Node with no dependencies.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from './new-module/templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function usage(message) {
  if (message) console.error(`new-module: ${message}\n`);
  console.error('Usage: npm run new-module -- <id> --label "Plant care" --icon sprout --hue <#rrggbb or free hue> --description "One line." [--short Plants] [--dry-run]');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.flags.dryRun = true;
    else if (a.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) usage(`${a} needs a value`);
      out.flags[a.slice(2)] = value;
      i++;
    } else out.positional.push(a);
  }
  return out;
}

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The source of every module manifest. */
function manifestSources() {
  const dir = join(ROOT, 'packages/core/src/modules');
  return readdirSync(dir)
    .filter((id) => existsSync(join(dir, id, 'manifest.ts')))
    .map((id) => readFileSync(join(dir, id, 'manifest.ts'), 'utf8'));
}

/** A single-quoted TypeScript string. */
const sq = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** An object key: bare when it can be, quoted when it has a dash. */
const key = (id, quote) => (/^[a-z_][a-z0-9_]*$/i.test(id) ? id : `${quote}${id}${quote}`);

const pascal = (id) => id.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const camel = (id) => {
  const p = pascal(id);
  return p[0].toLowerCase() + p.slice(1);
};
/** lucide's kebab name to its component name: "trash-2" to Trash2. */
const iconComponent = (icon) => icon.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

function names(args) {
  const [id] = args.positional;
  if (!id) usage('missing <id>');
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) usage(`id "${id}" must be kebab-case: lowercase letters, digits and dashes`);
  const { label, icon, hue, description } = args.flags;
  if (!label) usage('missing --label');
  if (!icon || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon)) usage('--icon must be a lucide icon name, such as sprout or trash-2');
  if (!description) usage('missing --description');
  if (/—/.test(label + description)) usage('no em dashes in UI copy (Hearth copy rules)');
  if (/\p{Extended_Pictographic}/u.test(label + description)) usage('no emoji in UI copy (Hearth copy rules)');
  const hueBlock = read('packages/core/src/section-hues.ts').match(/SECTION_HUE_IDS[^=]*= \[([^\]]*)\]/);
  const hues = hueBlock ? [...hueBlock[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]) : [];
  // Spaces show sections side by side, so every section wears its own hue
  // (module-manifests.test.ts). Home wears coral; the rest name theirs in
  // their manifest.
  const taken = new Set(['coral', ...manifestSources().flatMap((src) => [...src.matchAll(/^\s+hue: '(#?[0-9a-zA-Z]+)'/gm)].map((m) => m[1]))]);
  const free = hues.filter((h) => !taken.has(h));
  const hex = /^#[0-9a-f]{6}$/i.test(hue ?? '');
  if (!hue || (hex ? taken.has(hue.toUpperCase()) || taken.has(hue.toLowerCase()) : !free.includes(hue))) {
    usage(
      `--hue must be any colour as #rrggbb (its shades for each theme are worked out for you), or a curated hue no section wears yet${free.length ? `: ${free.join(', ')}` : ' (all are taken)'}`,
    );
  }
  const snake = id.replace(/-/g, '_');
  return {
    id,
    snake,
    table: `${snake}_items`,
    Pascal: pascal(id),
    camel: camel(id),
    label,
    sqLabel: sq(label),
    shortLabel: args.flags.short ?? label,
    sqShortLabel: sq(args.flags.short ?? label),
    description: /[.!?]$/.test(description) ? description : `${description}.`,
    sqDescription: sq(/[.!?]$/.test(description) ? description : `${description}.`),
    icon,
    Icon: iconComponent(icon),
    hue,
    itemKind: 'Item',
    emptyDescription: 'Add the first item to start the list.',
    dryRun: !!args.flags.dryRun,
  };
}

/** A migration version later than every file already there. */
function migrationVersion() {
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_/.test(f)).sort();
  const last = files.length ? files[files.length - 1].slice(0, 14) : '0';
  const now = new Date().toISOString().replace(/\D/g, '').slice(0, 12) + '00';
  if (now > last) return now;
  // Same day as the newest file, or a clock behind it: one hour after it.
  const d = new Date(Date.UTC(+last.slice(0, 4), +last.slice(4, 6) - 1, +last.slice(6, 8), +last.slice(8, 10) + 1, +last.slice(10, 12)));
  return d.toISOString().replace(/\D/g, '').slice(0, 12) + '00';
}

const writes = [];
const edits = new Map();

function create(path, content) {
  if (existsSync(join(ROOT, path))) throw new Error(`${path} already exists`);
  writes.push({ path, content });
}

function edit(path, fn) {
  const before = edits.has(path) ? edits.get(path) : read(path);
  edits.set(path, fn(before));
}

/** Inserts `lines` above the "new-module:<slot>" marker, at its indent. */
function atMarker(path, slot, lines) {
  edit(path, (s) => {
    const re = new RegExp(`^([ \\t]*)(?://|--) new-module:${slot} .*$`, 'm');
    const m = s.match(re);
    if (!m) throw new Error(`${path}: no "new-module:${slot}" marker. Add the entry by hand, then put the marker back.`);
    const indent = m[1];
    const block = (Array.isArray(lines) ? lines : [lines]).map((l) => (l ? indent + l : l)).join('\n');
    return s.slice(0, m.index) + block + '\n' + s.slice(m.index);
  });
}

/** Adds the icon to a platform's section-icons map when it isn't there yet. */
function sectionIcon(path, n, quote) {
  edit(path, (s) => {
    if (new RegExp(`^\\s+${quote}?${n.icon}${quote}?: `, 'm').test(s)) return s;
    const importEnd = s.match(/\n\} from ['"]lucide-react(-native)?['"];/);
    if (!importEnd) throw new Error(`${path}: lucide import not found`);
    if (!new RegExp(`^\\s+${n.Icon},$`, 'm').test(s.slice(0, importEnd.index))) {
      s = s.slice(0, importEnd.index) + `\n  ${n.Icon},` + s.slice(importEnd.index);
    }
    const map = s.match(/export const sectionIcons: Record<string, \w+> = \{\n/);
    if (!map) throw new Error(`${path}: sectionIcons map not found`);
    const at = map.index + map[0].length;
    return s.slice(0, at) + `  ${key(n.icon, quote)}: ${n.Icon},\n` + s.slice(at);
  });
}

function plan(n) {
  if (existsSync(join(ROOT, `packages/core/src/modules/${n.id}`))) throw new Error(`module "${n.id}" already exists`);
  const tableRe = new RegExp(`\\b${n.table}\\b`);
  if (tableRe.test(read('packages/core/src/assistant-reach.ts')) || manifestSources().some((src) => tableRe.test(src))) {
    throw new Error(`table ${n.table} already exists`);
  }

  const version = migrationVersion();
  const migrationName = `${version}_${n.snake}`;
  n.migrationName = migrationName;
  const today = new Date().toISOString().slice(0, 10);

  // New files.
  create(`packages/core/src/modules/${n.id}/manifest.ts`, T.manifest(n));
  create(`packages/core/src/modules/${n.id}/${n.id}.ts`, T.coreModule(n));
  create(`packages/core/src/modules/${n.id}/use-${n.id}.ts`, T.coreHook(n));
  create(`packages/core/src/modules/${n.id}/slots.ts`, T.coreSlots(n));
  create(`packages/core/src/modules/${n.id}/${n.id}.test.ts`, T.coreTest(n));
  create(`packages/core/src/data/stores/${n.id}-stores.ts`, T.coreStores(n));
  create(`apps/web/src/app/${n.id}/page.tsx`, T.webPage(n));
  create(`apps/web/src/app/${n.id}/loading.tsx`, T.webLoading(n));
  create(`apps/mobile/src/app/(tabs)/${n.id}/index.tsx`, T.mobileScreen(n));
  create(`apps/web/src/lib/mcp/tools/${n.id}-tools.ts`, T.webTools(n));
  create(`apps/web/src/lib/mcp/tools/${n.id}-tools.test.ts`, T.webToolsTest(n));
  create(`supabase/migrations/${migrationName}.sql`, T.migration(n));
  create(`whats-new/${today}-${n.id}.md`, T.whatsNew(n));

  // The manifest list, and what a manifest can't declare.
  const core = 'packages/core/src/';
  atMarker(core + 'module-manifests.ts', 'manifest-import', `import { ${n.camel}Module } from './modules/${n.id}/manifest';`);
  atMarker(core + 'module-manifests.ts', 'manifest', `${n.camel}Module,`);
  atMarker(core + 'index.ts', 'module-exports', `export * from './modules/${n.id}/${n.id}';`);
  atMarker(core + 'index.ts', 'module-hooks', `export * from './modules/${n.id}/use-${n.id}';`);
  atMarker(core + 'data/stores/index.ts', 'module-stores', `export * from './${n.id}-stores';`);
  atMarker(core + 'schema-check.ts', 'schema-check', `export type ${n.Pascal}ItemsMatches = Expect<Equal<Matches<App.${n.Pascal}Item, '${n.table}'>, Ok>>;`);
  atMarker('supabase/functions/_shared/module-rules.ts', 'module-defaults', `{ id: "${n.id}", defaultEnabled: false, requires: [] },`);

  // Its search source joins the global search (core slots/search.ts).
  atMarker(core + 'slots/search.ts', 'search-source-import', `import { ${n.camel}SearchSource } from '../modules/${n.id}/slots';`);
  atMarker(core + 'slots/search.ts', 'search-source', `${n.camel}SearchSource,`);
  atMarker(core + 'hooks/use-global-search-index.test.ts', 'search-fixture-import', `import { ${n.camel}SearchHits } from '../modules/${n.id}/slots';`);
  atMarker(
    core + 'hooks/use-global-search-index.test.ts',
    'search-fixture',
    `'${n.id}': ${n.camel}SearchHits([{ id: '${n.id}-1', title: ${n.sqLabel}, notes: null, deleted: false } as never]),`,
  );

  // Web.
  atMarker('apps/web/src/lib/mcp/household-tools.ts', 'tool-import', `import { ${n.camel}Tools } from "./tools/${n.id}-tools";`);
  atMarker('apps/web/src/lib/mcp/household-tools.ts', 'tool-push', `tools.push(...${n.camel}Tools({ admin, userId, groupId, enabled, shared }));`);
  sectionIcon('apps/web/src/lib/section-icons.ts', n, '"');
  // The landing page's module map leaves a module out until it has a spot and demo screens.
  edit('apps/web/src/components/landing/module-map-data.ts', (s) => {
    const re = /(export type MapModule = Exclude<ModuleId, [^>]*)>;/;
    if (!re.test(s)) throw new Error('module-map-data.ts: MapModule type not found');
    return s.replace(re, `$1 | "${n.id}">;`);
  });

  // Phone.
  sectionIcon('apps/mobile/src/lib/section-icons.ts', n, "'");

  return { migrationName };
}

function main() {
  const n = names(parseArgs(process.argv.slice(2)));
  let result;
  try {
    result = plan(n);
  } catch (err) {
    console.error(`new-module: ${err.message}`);
    process.exit(1);
  }

  if (n.dryRun) {
    console.log('Would create:');
    for (const w of writes) console.log(`  ${w.path}`);
    console.log('Would edit:');
    for (const path of edits.keys()) console.log(`  ${path}`);
    return;
  }
  for (const w of writes) {
    mkdirSync(dirname(join(ROOT, w.path)), { recursive: true });
    writeFileSync(join(ROOT, w.path), w.content);
  }
  for (const [path, content] of edits) writeFileSync(join(ROOT, path), content);

  console.log(`Created module "${n.id}" (${writes.length} new files, ${edits.size} registries).

Next:
  1. Generate the database types for the new table:
       npx supabase db start      (cloud: dockerd & first)
       npm run db:types
     Until then the typecheck stops at schema-check.ts.
  2. Reshape the starter into the module. Keep the split:
       packages/core/src/modules/${n.id}/   types, view helpers, row menus, hooks
       apps/web/src/app/${n.id}/            and apps/mobile/src/app/(tabs)/${n.id}/: binding and layout only
  3. Decide its privacy rule (repeat it in the tool handlers), where else it shows
     (agenda, Home, calendar, search) and its cross-module features (module-features.ts).
  4. Write the What's new entry in whats-new/ for the person using the app.
  5. npm run check
Migration: supabase/migrations/${result.migrationName}.sql (additive, gated by minSchema).`);
}

main();
