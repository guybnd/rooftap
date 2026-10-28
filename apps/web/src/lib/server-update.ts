import { compareVersion, versionFromTag, type ServerUpdate } from "@homeup/core";

// The server's side of GET /api/server-update (core app-release.ts): whether
// a newer Rooftap release than the one this server was built from is out.
// It asks GitHub for the newest release of ROOFTAP_SERVER_UPDATES (default
// the public repo; "off" never asks). The hosted server is built from main,
// which is never behind the newest release, so it finds nothing to offer.

const DEFAULT_REPO = "guybnd/rooftap";
const LOOKUP_TIMEOUT_MS = 3000;
/** Releases come every few days, so one ask in a few hours is plenty; a failed ask is retried sooner. */
const CACHE_MS = 6 * 60 * 60 * 1000;
const MISS_CACHE_MS = 30 * 60 * 1000;

let cached: { repo: string; at: number; latest: { version: string; url: string } | null } | null = null;

/** Forget the cached lookup (tests). */
export function resetServerUpdateCache(): void {
  cached = null;
}

/** The repo to ask, or null when the check is off or the value is not a repo. */
export function serverUpdateRepo(): string | null {
  const repo = (process.env.ROOFTAP_SERVER_UPDATES || DEFAULT_REPO).trim();
  if (/^(off|false|0|no)$/i.test(repo) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return repo;
}

async function newestRelease(repo: string, fetchImpl: typeof fetch): Promise<{ version: string; url: string } | null> {
  try {
    // /releases/latest skips drafts and pre-releases.
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Rooftap" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const version = versionFromTag(body.tag_name);
    if (!version || typeof body.html_url !== "string" || !body.html_url.startsWith("https://")) return null;
    return { version, url: body.html_url };
  } catch {
    return null;
  }
}

/** The newer release this server can move to, or null (none, unknown version, or the check is off). */
export async function serverUpdate(fetchImpl: typeof fetch = fetch): Promise<ServerUpdate | null> {
  const current = process.env.HOMEUP_APP_VERSION || "";
  const repo = serverUpdateRepo();
  if (!current || !repo) return null;

  if (!cached || cached.repo !== repo || Date.now() - cached.at >= (cached.latest ? CACHE_MS : MISS_CACHE_MS)) {
    cached = { repo, at: Date.now(), latest: await newestRelease(repo, fetchImpl) };
  }
  const latest = cached.latest;
  if (!latest || compareVersion(latest.version, current) <= 0) return null;
  return { current, latest: latest.version, url: latest.url };
}
