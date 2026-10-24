// App and server versions, and whether they still fit together.
//
// Two things ship separately. The phone app is an APK with a native build
// (its runtime, e.g. "57.5"); JS updates reach it over the air only while
// they are built for that same runtime, so a phone on an older APK silently
// stops getting them. The server (hosted or self-hosted) is a web build with
// its own release version and database schema (server-features.ts covers
// the schema side). /api/public-config reports the server's side:
//
// - version: the Rooftap release the server was built from.
// - minAppRuntime: the oldest phone build its API still serves.
// - latestApp: the newest phone release, with its runtime and where to get it.
//
// The phone compares its own runtime with those (appStanding) to say "a new
// version is out" or "this version is too old for your server". Web needs
// none of this: it is served by the server it talks to.

export interface AppRelease {
  /** Release version, e.g. "1.1.2". */
  version: string;
  /** Native runtime the release's APK was built for, e.g. "57.5". */
  runtime: string;
  /** Where to get it: the release page. */
  url: string;
}

export interface ServerRelease {
  /** The Rooftap release the server was built from; null when it does not say. */
  version: string | null;
  /** The oldest phone runtime the server still serves; null = any. */
  minAppRuntime: string | null;
  /** The newest phone release the server knows of; null = none to offer. */
  latestApp: AppRelease | null;
}

/**
 * The oldest phone build this server's API still serves. Raise it only when
 * an API change breaks older phones, in the same change; phones below it see
 * "Update the app".
 */
export const MIN_APP_RUNTIME = '57.3';

/** The device-local key that remembers which release the phone already announced. */
export const SEEN_APP_RELEASE_KEY = 'homeup.app-release.seen';

const RUNTIME = /^\d+(\.\d+)*$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** Orders two runtimes ("57.5" < "57.10" < "58.0"); 0 when either does not parse. */
export function compareRuntime(a: string, b: string): number {
  if (!RUNTIME.test(a) || !RUNTIME.test(b)) return 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** A release from /api/public-config, or null for anything malformed. */
export function cleanAppRelease(value: unknown): AppRelease | null {
  const v = value as Partial<Record<keyof AppRelease, unknown>> | null;
  if (!v || typeof v !== 'object') return null;
  if (typeof v.version !== 'string' || !VERSION.test(v.version)) return null;
  if (typeof v.runtime !== 'string' || !RUNTIME.test(v.runtime)) return null;
  if (typeof v.url !== 'string' || !/^https?:\/\//.test(v.url)) return null;
  return { version: v.version, runtime: v.runtime, url: v.url };
}

/** The server's side from a /api/public-config body; older servers give all nulls. */
export function serverReleaseFromConfig(config: { version?: unknown; minAppRuntime?: unknown; latestApp?: unknown }): ServerRelease {
  return {
    version: typeof config.version === 'string' && VERSION.test(config.version) ? config.version : null,
    minAppRuntime: typeof config.minAppRuntime === 'string' && RUNTIME.test(config.minAppRuntime) ? config.minAppRuntime : null,
    latestApp: cleanAppRelease(config.latestApp),
  };
}

/** Where the phone stands against its server. */
export type AppStanding =
  | { kind: 'unknown' }
  | { kind: 'current' }
  /** A newer APK is out; this one keeps working. */
  | { kind: 'update'; latest: AppRelease }
  /** This APK is older than the server serves; it needs the new one. */
  | { kind: 'too-old'; latest: AppRelease | null };

/**
 * Compares the phone's native runtime with what the server reports. Only a
 * newer runtime counts as an update: a newer release on the same runtime
 * arrives over the air on its own.
 */
export function appStanding(runtime: string | null | undefined, server: ServerRelease | undefined): AppStanding {
  if (!runtime || !RUNTIME.test(runtime) || !server) return { kind: 'unknown' };
  const latest = server.latestApp;
  if (server.minAppRuntime && compareRuntime(runtime, server.minAppRuntime) < 0) return { kind: 'too-old', latest };
  if (latest && compareRuntime(latest.runtime, runtime) > 0) return { kind: 'update', latest };
  return { kind: 'current' };
}

/** Whether to announce `standing` now, given the release the phone last announced. */
export function shouldAnnounceRelease(standing: AppStanding, seen: string | null): boolean {
  if (standing.kind === 'too-old') return true;
  return standing.kind === 'update' && standing.latest.version !== seen;
}

/** The notice for a phone that is behind; same copy wherever it shows. */
export function appUpdateNotice(standing: AppStanding): { title: string; description: string } | null {
  if (standing.kind === 'update') {
    return {
      title: `Rooftap ${standing.latest.version} is out`,
      description: 'This version needs a new install. Until you install it, this app gets no more updates.',
    };
  }
  if (standing.kind === 'too-old') {
    return {
      title: 'Update the app',
      description: standing.latest
        ? `Your server needs a newer app. Install Rooftap ${standing.latest.version} to keep everything working.`
        : 'Your server needs a newer app. Install the latest Rooftap to keep everything working.',
    };
  }
  return null;
}

/** The status line under the app version in About & updates. */
export function appStandingLabel(standing: AppStanding): string | null {
  switch (standing.kind) {
    case 'current':
      return 'Up to date';
    case 'update':
      return `${standing.latest.version} available`;
    case 'too-old':
      return 'Too old for this server';
    default:
      return null;
  }
}

/** The server version line in About & updates. */
export function serverVersionLabel(server: ServerRelease | undefined, schema: string | null | undefined): string {
  const version = server?.version ?? null;
  const stamp = schema ? schema.slice(0, 8) : null;
  const date = stamp && /^\d{8}$/.test(stamp) ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : null;
  if (version && date) return `${version} · ${date}`;
  return version ?? date ?? 'Older version';
}
