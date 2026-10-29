import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerUpdater, requestServerUpdate } from "./server-updater";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "updater-"));
  await mkdir(join(base, "inbox"));
  await mkdir(join(base, "state"));
  process.env.ROOFTAP_UPDATER_DIR = base;
});
afterEach(async () => {
  delete process.env.ROOFTAP_UPDATER_DIR;
  await rm(base, { recursive: true, force: true });
});

describe("server updater folders", () => {
  it("has no updater without the folder setting", async () => {
    delete process.env.ROOFTAP_UPDATER_DIR;
    expect(await readServerUpdater()).toBeNull();
    expect(await requestServerUpdate("1.2.0")).toBe(false);
  });

  it("reads whether it is on and how the last run went", async () => {
    expect(await readServerUpdater()).toEqual({ installed: false, pending: false, pendingSince: null, status: null });
    await writeFile(join(base, "state", "updater.json"), JSON.stringify({ installed: true }));
    await writeFile(join(base, "state", "status.json"), JSON.stringify({ state: "running", step: "build", target: "1.2.0", from: "1.1.3" }));
    const updater = await readServerUpdater();
    expect(updater?.installed).toBe(true);
    expect(updater?.status).toMatchObject({ state: "running", step: "build", target: "1.2.0" });
  });

  it("ignores a status file that is not one", async () => {
    await writeFile(join(base, "state", "status.json"), "not json");
    expect((await readServerUpdater())?.status).toBeNull();
  });

  it("leaves one request with only the version, and no second while it waits", async () => {
    expect(await requestServerUpdate("1.2.0")).toBe(true);
    expect(await readFile(join(base, "inbox", "request"), "utf8")).toBe("1.2.0\n");
    expect((await readServerUpdater())?.pending).toBe(true);
    expect(await requestServerUpdate("1.2.0")).toBe(false);
    expect(await readdir(join(base, "inbox"))).toEqual(["request"]);
  });

  it("replaces a request the updater never picked up", async () => {
    const request = join(base, "inbox", "request");
    await writeFile(request, "1.1.9\n");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(request, old, old);
    expect(await requestServerUpdate("1.2.0")).toBe(true);
    expect(await readFile(request, "utf8")).toBe("1.2.0\n");
  });
});
