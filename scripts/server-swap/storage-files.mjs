#!/usr/bin/env node
// Copies Supabase Storage files for the emergency server swap
// (.docs/server-swap.md). Talks to the Storage API only, so it works the same
// against hosted Supabase and the self-hosted stack.
//
//   node scripts/server-swap/storage-files.mjs export <dir>
//     SUPABASE_URL + SERVICE_ROLE_KEY of the server to copy from. Writes every
//     bucket's files to <dir>/<bucket>/<path> and their list to
//     <dir>/files.json.
//   node scripts/server-swap/storage-files.mjs import <dir>
//     SUPABASE_URL + SERVICE_ROLE_KEY of the server to copy to. Creates
//     missing buckets and uploads every file in files.json (overwriting).
//
// Files kept in Cloudflare R2 (the documents store on hosted) are not in
// Supabase Storage and are not copied. The new server reads them from R2
// when it has the same R2_* settings.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [mode, dir] = process.argv.slice(2);
const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = process.env.SERVICE_ROLE_KEY ?? '';
if (!['export', 'import'].includes(mode) || !dir || !base || !key) {
  console.error('Usage: SUPABASE_URL=... SERVICE_ROLE_KEY=... node storage-files.mjs export|import <dir>');
  process.exit(1);
}

const auth = { apikey: key, authorization: `Bearer ${key}` };
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

async function api(method, path, { json, body, headers } = {}) {
  const res = await fetch(`${base}/storage/v1/${path}`, {
    method,
    headers: { ...auth, ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

// The list endpoint returns one folder level: folders have no id.
async function listAll(bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await (
      await api('POST', `object/list/${encodeURIComponent(bucket)}`, {
        json: { prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } },
      })
    ).json();
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listAll(bucket, path)));
      else files.push({ bucket, path, contentType: entry.metadata?.mimetype ?? 'application/octet-stream' });
    }
    if (page.length < 1000) return files;
  }
}

if (mode === 'export') {
  const buckets = await (await api('GET', 'bucket')).json();
  const files = [];
  for (const bucket of buckets) {
    const list = await listAll(bucket.id);
    for (const file of list) {
      const data = Buffer.from(await (await api('GET', `object/${encodeURIComponent(file.bucket)}/${encodePath(file.path)}`)).arrayBuffer());
      const target = join(dir, file.bucket, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      files.push(file);
    }
    console.log(`${bucket.id}: ${list.length} file(s)`);
  }
  const meta = buckets.map((b) => ({ id: b.id, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types }));
  await writeFile(join(dir, 'files.json'), JSON.stringify({ buckets: meta, files }, null, 1));
  console.log(`exported ${files.length} file(s) from ${buckets.length} bucket(s)`);
} else {
  const { buckets, files } = JSON.parse(await readFile(join(dir, 'files.json'), 'utf8'));
  const existing = new Set((await (await api('GET', 'bucket')).json()).map((b) => b.id));
  for (const bucket of buckets) {
    if (existing.has(bucket.id)) continue;
    await api('POST', 'bucket', {
      json: { id: bucket.id, name: bucket.id, public: bucket.public, file_size_limit: bucket.file_size_limit, allowed_mime_types: bucket.allowed_mime_types },
    });
    console.log(`created bucket ${bucket.id}`);
  }
  let done = 0;
  for (const file of files) {
    const body = await readFile(join(dir, file.bucket, ...file.path.split('/')));
    await api('POST', `object/${encodeURIComponent(file.bucket)}/${encodePath(file.path)}`, {
      body,
      headers: { 'content-type': file.contentType, 'x-upsert': 'true' },
    });
    done += 1;
    if (done % 100 === 0) console.log(`uploaded ${done}/${files.length}`);
  }
  console.log(`imported ${done} file(s)`);
}
