import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerUpdateCache, serverUpdate } from "./server-update";

const ORIGINAL_ENV = { ...process.env };
const PAGE = "https://github.com/guybnd/rooftap/releases/tag/v1.2.0";

function github(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("serverUpdate", () => {
  beforeEach(() => {
    resetServerUpdateCache();
    process.env = { ...ORIGINAL_ENV, HOMEUP_APP_VERSION: "1.1.3" };
    delete process.env.ROOFTAP_SERVER_UPDATES;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("offers a newer release from the public repo", async () => {
    const fetchImpl = github({ tag_name: "v1.2.0", html_url: PAGE });
    expect(await serverUpdate(fetchImpl)).toEqual({ current: "1.1.3", latest: "1.2.0", url: PAGE });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.github.com/repos/guybnd/rooftap/releases/latest");
  });

  it("offers nothing when the server is on the newest release or ahead of it", async () => {
    expect(await serverUpdate(github({ tag_name: "v1.1.3", html_url: PAGE }))).toBeNull();
    resetServerUpdateCache();
    expect(await serverUpdate(github({ tag_name: "v1.1.2", html_url: PAGE }))).toBeNull();
  });

  it("never asks when the check is off or the server does not know its version", async () => {
    process.env.ROOFTAP_SERVER_UPDATES = "off";
    const fetchImpl = github({ tag_name: "v1.2.0", html_url: PAGE });
    expect(await serverUpdate(fetchImpl)).toBeNull();
    process.env.ROOFTAP_SERVER_UPDATES = "";
    delete process.env.HOMEUP_APP_VERSION;
    expect(await serverUpdate(fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks another repo when one is named", async () => {
    process.env.ROOFTAP_SERVER_UPDATES = "me/my-rooftap";
    const fetchImpl = github({ tag_name: "v1.2.0", html_url: PAGE });
    await serverUpdate(fetchImpl);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.github.com/repos/me/my-rooftap/releases/latest");
  });

  it("keeps the answer for hours, and treats errors and odd tags as no update", async () => {
    const fetchImpl = github({ tag_name: "v1.2.0", html_url: PAGE });
    await serverUpdate(fetchImpl);
    await serverUpdate(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resetServerUpdateCache();
    expect(await serverUpdate(github({ message: "rate limited" }, 403))).toBeNull();
    resetServerUpdateCache();
    expect(await serverUpdate(github({ tag_name: "nightly", html_url: PAGE }))).toBeNull();
    resetServerUpdateCache();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await serverUpdate(failing)).toBeNull();
  });
});
