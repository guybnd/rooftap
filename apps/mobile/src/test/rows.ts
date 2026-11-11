// Rows for screen tests, shaped from the generated database types
// (packages/core/src/database.types.ts), so a fixture keeps up with the schema.
//   row(table, over)        a whole row with plain values, `over` on top
//   nullRow(table, over)    every nullable column null: the sparsest row the database allows
//   oldServerRow(table, over) every nullable column missing: a row from a server that predates them
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface Column {
  name: string;
  type: string;
  nullable: boolean;
}

const typesFile = path.resolve(__dirname, '../../../../packages/core/src/database.types.ts');
// Normalised: a Windows checkout has CRLF line ends.
const source = readFileSync(typesFile, 'utf8').replace(/\r\n/g, '\n');
const cache = new Map<string, Column[]>();

export function columnsOf(table: string): Column[] {
  const hit = cache.get(table);
  if (hit) return hit;
  const start = source.indexOf(`\n      ${table}: {\n        Row: {\n`);
  if (start < 0) throw new Error(`No table ${table} in database.types.ts`);
  const body = source.slice(source.indexOf('Row: {', start) + 'Row: {'.length, source.indexOf('\n        }', start));
  const columns = body
    .split('\n')
    .map((line) => /^\s+(\w+): (.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, name, type]) => ({ name, type: type.trim(), nullable: /\|\s*null$/.test(type.trim()) }));
  cache.set(table, columns);
  return columns;
}

let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

function plainValue(table: string, col: Column): unknown {
  const t = col.type.replace(/\s*\|\s*null$/, '');
  if (col.name === 'id') return uuid();
  if (t.endsWith('[]')) return [];
  if (t === 'boolean') return false;
  if (t === 'number') return 1;
  if (t === 'Json') return {};
  if (/^"/.test(t)) return /^"([^"]+)"/.exec(t)![1];
  if (/_at$/.test(col.name)) return '2026-11-01T09:00:00Z';
  if (/(_date|_on|^date)$/.test(col.name)) return '2026-11-12';
  if (/_time$/.test(col.name)) return '09:00:00';
  if (/_id$|_by$|^assigned_to$/.test(col.name)) return null;
  if (col.name === 'title' || col.name === 'name') return `A ${table.replace(/_/g, ' ')}`;
  return col.nullable ? null : '';
}

export function row(table: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columnsOf(table)) out[col.name] = plainValue(table, col);
  return { ...out, ...over };
}

export function nullRow(table: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const out = row(table);
  for (const col of columnsOf(table)) if (col.nullable) out[col.name] = null;
  return { ...out, ...over };
}

export function oldServerRow(table: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const out = row(table);
  for (const col of columnsOf(table)) if (col.nullable) delete out[col.name];
  return { ...out, ...over };
}
