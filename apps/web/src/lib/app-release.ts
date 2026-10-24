import { MIN_APP_RUNTIME, type AppRelease, type ServerRelease } from "@homeup/core";

// The server's side of core app-release.ts, for /api/public-config. The
// newest phone release is the one this server was built from, offered only
// once its release page has the APK (a version bump merges before the APK is
// attached). The page is looked up on GitHub (ROOFTAP_APP_RELEASES, default
// the public repo; "off" offers none). A self-hoster who hands out the app
// another way sets APP_DOWNLOAD_URL instead, which skips the lookup.

const DEFAULT_REPO = "guybnd/rooftap";
const LOOKUP_TIMEOUT_MS = 3000;
/** How long a found release is kept; a miss is asked again sooner, as the APK may be on its way. */
const CACHE_MS = 60 * 60 * 1000;
const MISS_CACHE_MS = 10 * 60 * 1000;

let cached: { key: string; at: number; release: AppRelease | null } | null = null;

/** Forget the cached lookup (tests). */
export function resetAppReleaseCache(): void {
  cached = null;
}

async function releasePage(repo: string, version: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/v${encodeURIComponent(version)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Rooftap" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { html_url?: unknown; draft?: unknown; assets?: { name?: unknown }[] };
    if (body.draft === true || typeof body.html_url !== "string") return null;
    const hasApk = Array.isArray(body.assets) && body.assets.some((a) => typeof a?.name === "string" && a.name.endsWith(".apk"));
    return hasApk ? body.html_url : null;
  } catch {
    return null;
  }
}

/** The newest phone release this server offers, or null. */
export async function latestAppRelease(fetchImpl: typeof fetch = fetch): Promise<AppRelease | null> {
  const version = process.env.HOMEUP_APP_VERSION || "";
  const runtime = process.env.HOMEUP_APP_RUNTIME || "";
  if (!version || !runtime) return null;
  const direct = process.env.APP_DOWNLOAD_URL?.trim();
  if (direct) return /^https?:\/\//.test(direct) ? { version, runtime, url: direct } : null;
  const repo = (process.env.ROOFTAP_APP_RELEASES || DEFAULT_REPO).trim();
  if (/^(off|false|0|no)$/i.test(repo) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;

  const key = `${repo}@${version}`;
  if (cached && cached.key === key && Date.now() - cached.at < (cached.release ? CACHE_MS : MISS_CACHE_MS)) return cached.release;
  const url = await releasePage(repo, version, fetchImpl);
  const release = url ? { version, runtime, url } : null;
  cached = { key, at: Date.now(), release };
  return release;
}

/** Everything /api/public-config says about versions. */
export async function serverRelease(fetchImpl: typeof fetch = fetch): Promise<ServerRelease> {
  return {
    version: process.env.HOMEUP_APP_VERSION || null,
    minAppRuntime: MIN_APP_RUNTIME,
    latestApp: await latestAppRelease(fetchImpl),
  };
}
