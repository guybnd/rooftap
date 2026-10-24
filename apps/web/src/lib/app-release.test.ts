import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_APP_RUNTIME } from "@homeup/core";
import { latestAppRelease, resetAppReleaseCache, serverRelease } from "./app-release";

const ORIGINAL_ENV = { ...process.env };

function github(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const PAGE = "https://github.com/guybnd/rooftap/releases/tag/v1.1.3";

describe("latestAppRelease", () => {
  beforeEach(() => {
    resetAppReleaseCache();
    process.env = { ...ORIGINAL_ENV, HOMEUP_APP_VERSION: "1.1.3", HOMEUP_APP_RUNTIME: "57.6" };
    delete process.env.APP_DOWNLOAD_URL;
    delete process.env.ROOFTAP_APP_RELEASES;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("offers the build's own release once its page has an APK", async () => {
    const fetchImpl = github({ html_url: PAGE, assets: [{ name: "rooftap-android-1.1.3.apk" }] });
    expect(await latestAppRelease(fetchImpl)).toEqual({ version: "1.1.3", runtime: "57.6", url: PAGE });
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe(
      "https://api.github.com/repos/guybnd/rooftap/releases/tags/v1.1.3"
    );
  });

  it("offers nothing while the release has no APK yet, or is missing", async () => {
    expect(await latestAppRelease(github({ html_url: PAGE, assets: [] }))).toBeNull();
    resetAppReleaseCache();
    expect(await latestAppRelease(github({ message: "Not Found" }, 404))).toBeNull();
  });

  it("keeps a found release for an hour without asking again", async () => {
    const fetchImpl = github({ html_url: PAGE, assets: [{ name: "a.apk" }] });
    await latestAppRelease(fetchImpl);
    await latestAppRelease(fetchImpl);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("uses APP_DOWNLOAD_URL without a lookup, and offers none when switched off", async () => {
    const fetchImpl = github({});
    process.env.APP_DOWNLOAD_URL = "https://apps.example.com/rooftap";
    expect(await latestAppRelease(fetchImpl)).toEqual({ version: "1.1.3", runtime: "57.6", url: "https://apps.example.com/rooftap" });
    delete process.env.APP_DOWNLOAD_URL;
    process.env.ROOFTAP_APP_RELEASES = "off";
    expect(await latestAppRelease(fetchImpl)).toBeNull();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("reports the build's version and the oldest phone it serves", async () => {
    const out = await serverRelease(github({ html_url: PAGE, assets: [{ name: "a.apk" }] }));
    expect(out).toEqual({ version: "1.1.3", minAppRuntime: MIN_APP_RUNTIME, latestApp: { version: "1.1.3", runtime: "57.6", url: PAGE } });
  });
});
