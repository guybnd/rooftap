// Where documents-store files live (.docs/r2-storage.md). Hosted Rooftap keeps
// new files in Cloudflare R2 and copies existing ones there; Supabase Storage
// stays the fallback for self-hosted servers, for files not copied yet, and
// whenever the server's /api/storage route can't be reached. Every caller
// treats a null reply as "use Supabase as before".
//
// Each app registers its platform half once at startup with
// configureDocumentStorage(): web posts same-origin with its cookie, native
// posts to the configured server with a Bearer token and streams uploads
// from disk. Nothing registered (tests, widgets) means Supabase only.

export interface DocumentStorageEnvironment {
  /** POST JSON to a server API route; resolve the parsed reply, reject on a non-2xx status. */
  postJson(path: string, body: unknown): Promise<unknown>;
  /**
   * Upload to a presigned URL. `source` is the in-memory body or a native file
   * uri. Resolve the HTTP status; the caller checks it.
   */
  putFile(url: string, headers: Record<string, string>, source: { body?: unknown; uri?: string }): Promise<number>;
  /** Native only: read a local file into memory for the Supabase fallback upload. */
  readFile?(uri: string): Promise<ArrayBuffer>;
}

let env: DocumentStorageEnvironment | null = null;

export function configureDocumentStorage(next: DocumentStorageEnvironment | null): void {
  env = next;
  r2OffUntil = 0;
}

export function getDocumentStorage(): DocumentStorageEnvironment | null {
  return env;
}

export type StorageReply =
  | { provider: 'supabase'; r2?: boolean }
  | { provider: 'r2'; url?: string; headers?: Record<string, string> };

export interface StorageRequest {
  op: 'upload' | 'view' | 'delete';
  bucket: string;
  path: string;
  mimeType?: string;
  sizeBytes?: number;
}

// When the server says R2 isn't configured, skip the round trip for a while
// so self-hosted servers don't pay an extra request on every file view.
const R2_OFF_CACHE_MS = 5 * 60 * 1000;
let r2OffUntil = 0;

/** Ask the server how to handle a file. null = use Supabase Storage directly. */
export async function requestDocumentStorage(req: StorageRequest): Promise<StorageReply | null> {
  if (!env || Date.now() < r2OffUntil) return null;
  try {
    const reply = (await env.postJson('/api/storage', req)) as StorageReply | null;
    if (!reply || (reply.provider !== 'r2' && reply.provider !== 'supabase')) return null;
    if (reply.provider === 'supabase' && reply.r2 === false) r2OffUntil = Date.now() + R2_OFF_CACHE_MS;
    return reply;
  } catch {
    // Old server without the route, offline, or R2 trouble: Supabase as before.
    return null;
  }
}
