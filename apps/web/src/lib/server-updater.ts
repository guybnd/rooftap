import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { cleanUpdaterStatus, UPDATER_PICKUP_MS, type ServerUpdater } from "@homeup/core";

// The app's side of one-click updates (scripts/updater/, core
// server-updater.ts). The updater runs on the host. docker-compose.yml mounts
// its folders at ROOFTAP_UPDATER_DIR: `inbox`, the only place the app can
// write, and `state`, read-only. The app writes one version number to
// inbox/request and reads progress from state/status.json. Without the
// variable (the hosted server, a dev machine) there is no updater.

const MAX_STATE_BYTES = 16 * 1024;

function dir(): string | null {
  return process.env.ROOFTAP_UPDATER_DIR?.trim() || null;
}

async function readJson(path: string): Promise<unknown> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.length > MAX_STATE_BYTES ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** When the file was last written, or null when there is none. */
async function writtenAt(path: string): Promise<Date | null> {
  try {
    return (await lstat(path)).mtime;
  } catch {
    return null;
  }
}

/** The updater as the operator sees it, or null on a server with none. */
export async function readServerUpdater(): Promise<ServerUpdater | null> {
  const base = dir();
  if (!base) return null;
  const info = (await readJson(join(base, "state", "updater.json"))) as { installed?: unknown } | null;
  const requested = await writtenAt(join(base, "inbox", "request"));
  return {
    installed: info?.installed === true,
    pending: requested !== null,
    pendingSince: requested?.toISOString() ?? null,
    status: cleanUpdaterStatus(await readJson(join(base, "state", "status.json"))),
  };
}

/**
 * Leaves a request for `version` in the inbox. The updater checks the version
 * itself, so this is only a request. Written under a temporary name and
 * renamed, so the updater never reads half a file. False when a request already
 * waits; a request the updater never picked up is replaced.
 */
export async function requestServerUpdate(version: string): Promise<boolean> {
  const base = dir();
  if (!base) return false;
  const request = join(base, "inbox", "request");
  const waiting = await writtenAt(request);
  if (waiting) {
    if (Date.now() - waiting.getTime() < UPDATER_PICKUP_MS) return false;
    await unlink(request).catch(() => {});
  }
  const tmp = join(base, "inbox", `.request-${randomBytes(6).toString("hex")}`);
  const handle = await open(tmp, "wx", 0o644);
  try {
    await handle.writeFile(`${version}\n`);
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, request);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return true;
}
