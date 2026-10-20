// Cloudflare R2 request signing (AWS Signature V4, query-string presign).
// Plain .mjs with node:crypto so both the web API routes and the one-off copy
// script (scripts/storage/copy-to-r2.mjs) share one implementation without a
// TS runner. Server-only: never import this from client code, it handles the
// R2 secret. See .docs/r2-storage.md.

import { createHash, createHmac } from "node:crypto";

/** RFC 3986 encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone). */
function rfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Encode an object key for the URL path, keeping `/` separators. */
export function encodeKeyPath(key) {
  return key.split("/").map(rfc3986).join("/");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function amzDates(now) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Presign a request. `path` is the already-encoded URL path (leading slash).
 * `headers` (lowercase names) are signed, so the caller must send exactly
 * these values: that is how an upload URL pins its content type and length.
 *
 * @param {{ method: string, host: string, path: string, region: string,
 *   accessKeyId: string, secretAccessKey: string, expiresIn: number,
 *   headers?: Record<string, string>, now?: Date }} args
 * @returns {string} the presigned https URL
 */
export function presignUrl({ method, host, path, region, accessKeyId, secretAccessKey, expiresIn, headers = {}, now = new Date() }) {
  const { amzDate, dateStamp } = amzDates(now);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const allHeaders = { host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const headerNames = Object.keys(allHeaders).sort();
  const signedHeaders = headerNames.join(";");
  const canonicalHeaders = headerNames.map((h) => `${h}:${allHeaders[h]}\n`).join("");

  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join("&");

  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * R2 settings from the environment, or null when R2 isn't set up (self-host,
 * or before the hosted secrets are added). Everything falls back to Supabase
 * Storage when this is null.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string } | null}
 */
export function r2ConfigFromEnv(env) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/**
 * Presign a request for one object. R2 objects are keyed `<supabase bucket>/<path>`
 * so a Supabase object and its R2 copy share an address.
 *
 * @param {{ accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string }} config
 * @param {{ method: string, key: string, expiresIn: number, headers?: Record<string, string>, now?: Date }} req
 */
export function presignR2(config, { method, key, expiresIn, headers, now }) {
  return presignUrl({
    method,
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: `/${config.bucket}/${encodeKeyPath(key)}`,
    region: "auto",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresIn,
    headers,
    now,
  });
}

/** The R2 key for a Supabase Storage object. */
export function r2Key(bucket, path) {
  return `${bucket}/${path}`;
}
