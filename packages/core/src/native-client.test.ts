import { describe, expect, it } from "vitest";
import { createChunkedStorage, hasPersistedSession, nativeAuthStorageKey, type StorageAdapter } from "./native-client";

// In-memory adapter that mimics a size-limited store like expo-secure-store
// (~2KB/value) — write/read throws if a single value ever exceeds the cap,
// so any test that leaks an unchunked oversized write fails loudly.
function createLimitedAdapter(maxValueLength: number): StorageAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async setItem(key, value) {
      if (value.length > maxValueLength) {
        throw new Error(`value for ${key} exceeds adapter limit (${value.length} > ${maxValueLength})`);
      }
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
  };
}

describe("createChunkedStorage", () => {
  it("round-trips a value smaller than the chunk size", async () => {
    const storage = createChunkedStorage(createLimitedAdapter(2000), 1800);
    await storage.setItem("session", "small-value");
    expect(await storage.getItem("session")).toBe("small-value");
  });

  it("round-trips a value larger than the adapter's per-key limit by splitting into chunks", async () => {
    const limited = createLimitedAdapter(2000);
    const storage = createChunkedStorage(limited, 1800);
    // A realistic Supabase session JSON blob easily exceeds 2KB.
    const big = "x".repeat(9000);

    await storage.setItem("sb-project-auth-token", big);

    // No single underlying write exceeded the adapter's cap.
    Array.from(limited.store.values()).forEach((value) => {
      expect(value.length).toBeLessThanOrEqual(1800);
    });
    expect(await storage.getItem("sb-project-auth-token")).toBe(big);
  });

  it("shrinking a value cleans up now-orphaned trailing chunks", async () => {
    const limited = createLimitedAdapter(2000);
    const storage = createChunkedStorage(limited, 1800);

    await storage.setItem("key", "x".repeat(9000)); // 5 chunks
    await storage.setItem("key", "y".repeat(100)); // 1 chunk

    expect(await storage.getItem("key")).toBe("y".repeat(100));
    // Only chunk 0 + the manifest should remain — no stale chunk.1..4.
    expect(Array.from(limited.store.keys()).sort()).toEqual(["key.0", "key.chunks"]);
  });

  it("getItem returns null for a never-written key", async () => {
    const storage = createChunkedStorage(createLimitedAdapter(2000));
    expect(await storage.getItem("missing")).toBeNull();
  });

  it("removeItem clears every chunk plus the manifest", async () => {
    const limited = createLimitedAdapter(2000);
    const storage = createChunkedStorage(limited, 1800);
    await storage.setItem("key", "x".repeat(9000));

    await storage.removeItem("key");

    expect(await storage.getItem("key")).toBeNull();
    expect(limited.store.size).toBe(0);
  });

  it("round-trips an empty string", async () => {
    const storage = createChunkedStorage(createLimitedAdapter(2000), 1800);
    await storage.setItem("key", "");
    expect(await storage.getItem("key")).toBe("");
  });
});

describe("nativeAuthStorageKey", () => {
  it("matches supabase-js's default key so existing stored sessions keep resolving", () => {
    expect(nativeAuthStorageKey("https://abcdefgh.supabase.co")).toBe("sb-abcdefgh-auth-token");
    expect(nativeAuthStorageKey("http://localhost:54321")).toBe("sb-localhost-auth-token");
  });
});

describe("hasPersistedSession", () => {
  const url = "https://abcdefgh.supabase.co";

  it("is true for a stored session with a refresh token, read through chunked storage", async () => {
    const storage = createChunkedStorage(createLimitedAdapter(2000), 1800);
    const session = { access_token: "a".repeat(3000), refresh_token: "r", expires_at: 0 };
    await storage.setItem(nativeAuthStorageKey(url), JSON.stringify(session));
    expect(await hasPersistedSession(storage, url)).toBe(true);
  });

  it("is false when nothing is stored, the value is not JSON, or it lacks a refresh token", async () => {
    const adapter = createLimitedAdapter(2000);
    expect(await hasPersistedSession(adapter, url)).toBe(false);
    await adapter.setItem(nativeAuthStorageKey(url), "not json");
    expect(await hasPersistedSession(adapter, url)).toBe(false);
    await adapter.setItem(nativeAuthStorageKey(url), JSON.stringify({ access_token: "a" }));
    expect(await hasPersistedSession(adapter, url)).toBe(false);
  });
});
