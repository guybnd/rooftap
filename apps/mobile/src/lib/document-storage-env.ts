// apps/mobile's half of packages/core's document-storage seam
// (.docs/r2-storage.md). /api/storage calls go to the configured server with
// the session's Bearer token (the route's getSessionUser() accepts it, as
// parse-receipt does). Uploads stream a picked file from disk with
// uploadAsync, so a big PDF is never held in JS memory; it is only read into
// memory when the file falls back to Supabase Storage.
// Registered as a side effect from lib/legend/environment.ts.

import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { configureDocumentStorage, type DocumentStorageEnvironment } from '@homeup/core';
import { getCurrentSupabaseClient } from './supabase-client';
import { getStoredServer } from './server-config';

const nativeDocumentStorage: DocumentStorageEnvironment = {
  async postJson(path, body) {
    const server = await getStoredServer();
    if (!server) throw new Error('No server configured.');
    const {
      data: { session },
    } = await getCurrentSupabaseClient().auth.getSession();
    const res = await fetch(`${server.origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json();
  },
  async putFile(url, headers, source) {
    if (source.uri) {
      const res = await FileSystem.uploadAsync(url, source.uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers,
      });
      return res.status;
    }
    const res = await fetch(url, { method: 'PUT', headers, body: source.body as BodyInit });
    return res.status;
  },
  async readFile(uri) {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return decode(base64);
  },
};

configureDocumentStorage(nativeDocumentStorage);
