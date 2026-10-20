// Server-only R2 helpers for the documents store (.docs/r2-storage.md).
// Each call presigns a short-lived request with r2-sign.mjs and runs it with
// fetch, so there is no S3 SDK. When R2 isn't configured (self-host, or before
// the hosted secrets exist) getR2Config() is null and callers fall back to
// Supabase Storage.

import { presignR2, r2ConfigFromEnv, r2Key } from "./r2-sign.mjs";

export { r2Key };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The group id a storage path belongs to, or null when the path is malformed. */
export function groupIdFromPath(path: string): string | null {
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) return null;
  const first = path.split("/")[0];
  return UUID.test(first) && path.length > first.length + 1 ? first : null;
}

/** Supabase buckets whose objects may live in R2. Only the documents store for now. */
export const R2_BUCKETS = new Set(["documents"]);

export function getR2Config() {
  return r2ConfigFromEnv(process.env);
}

type R2Config = NonNullable<ReturnType<typeof getR2Config>>;

/** True when the object exists in R2. A non-404 failure throws so callers don't mistake an outage for "not copied". */
export async function r2Exists(config: R2Config, key: string): Promise<boolean> {
  const res = await fetch(presignR2(config, { method: "HEAD", key, expiresIn: 60 }), { method: "HEAD" });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`R2 HEAD failed: ${res.status}`);
}

export function r2ViewUrl(config: R2Config, key: string, expiresIn: number): string {
  return presignR2(config, { method: "GET", key, expiresIn });
}

/** A PUT URL pinned to this exact content type and byte length. */
export function r2UploadUrl(config: R2Config, key: string, mimeType: string, sizeBytes: number, expiresIn: number): string {
  return presignR2(config, {
    method: "PUT",
    key,
    expiresIn,
    headers: { "content-type": mimeType, "content-length": String(sizeBytes) },
  });
}

export async function r2Delete(config: R2Config, key: string): Promise<void> {
  const res = await fetch(presignR2(config, { method: "DELETE", key, expiresIn: 60 }), { method: "DELETE" });
  // R2 answers 204 whether or not the object existed.
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed: ${res.status}`);
}

/** The object's bytes, or null when it isn't in R2. */
export async function r2Download(config: R2Config, key: string): Promise<ArrayBuffer | null> {
  const res = await fetch(r2ViewUrl(config, key, 60));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET failed: ${res.status}`);
  return res.arrayBuffer();
}
