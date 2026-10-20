'use client';

// apps/web's half of packages/core's document-storage seam
// (.docs/r2-storage.md): same-origin /api/storage calls ride the session
// cookie, and uploads PUT the in-memory File straight to the presigned R2 URL.
// Registered as a side effect from lib/legend/environment.ts.

import { configureDocumentStorage, type DocumentStorageEnvironment } from '@homeup/core';

const webDocumentStorage: DocumentStorageEnvironment = {
  async postJson(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json();
  },
  async putFile(url, headers, source) {
    const res = await fetch(url, { method: 'PUT', headers, body: source.body as BodyInit });
    return res.status;
  },
};

configureDocumentStorage(webDocumentStorage);
