// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeroModuleConfig } from "./use-hero-module-config";

// FLUX-258: isolates this hook's own debounce/reconciliation logic (the code
// this ticket actually changed) by mocking `useDataCache` and the Supabase
// client directly, rather than re-driving DataCacheProvider's fetch
// machinery — apps/web/src/lib/data-cache.test.tsx already covers that.
//
// HOUP-302 caveat: inside a ticket worktree, `@homeup/core` resolves through
// a node_modules junction to the MAIN tree's unedited copy, so this file may
// fail here on `createWriteGate` not existing, or pass against stale
// behaviour — neither result is evidence in that environment. The trusted
// signal is `packages/core/src/hero.test.ts`, run package-locally from
// `packages/core`; this file is for CI, which resolves the real package.

type UserSettingsShape = {
  home_hero_modules: Record<string, boolean> | null;
  home_hero_countdown: { label: string; date: string } | null;
};

const state = vi.hoisted(() => ({
  userSettings: null as UserSettingsShape | null,
  currentUserId: "user-1" as string | null,
  refresh: vi.fn(async () => undefined),
}));

const upsertSpy = vi.hoisted(() =>
  vi.fn(async (_payload: Record<string, unknown>, _opts?: Record<string, unknown>) => ({ data: null, error: null }))
);

vi.mock("@/lib/data-cache", () => ({
  useDataCache: () => state,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ upsert: upsertSpy }),
  }),
}));

async function renderHook() {
  let latest: ReturnType<typeof useHeroModuleConfig> | undefined;
  function Probe() {
    latest = useHeroModuleConfig();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });
  return {
    root,
    rerender: async () => {
      await act(async () => {
        root.render(<Probe />);
      });
    },
    getValue: () => {
      if (!latest) throw new Error("Probe never rendered");
      return latest;
    },
  };
}

describe("useHeroModuleConfig countdown debounce + reconciliation (FLUX-258)", () => {
  let roots: Root[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    state.userSettings = { home_hero_modules: {}, home_hero_countdown: null };
    state.currentUserId = "user-1";
    state.refresh.mockClear();
    upsertSpy.mockClear();
    roots = [];
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    vi.useRealTimers();
  });

  it("does not clobber an optimistic countdown with a remote change arriving mid-debounce, and reconciles once the write settles", async () => {
    const { root, rerender, getValue } = await renderHook();
    roots.push(root);

    act(() => {
      getValue().setCountdown({ label: "Trip", date: "2026-08-01" });
    });
    expect(getValue().countdown).toEqual({ label: "Trip", date: "2026-08-01" });

    // A remote userSettings change arrives mid-debounce (e.g. another write
    // landing, or a realtime refetch) — must not blank the in-progress edit.
    state.userSettings = { home_hero_modules: {}, home_hero_countdown: null };
    await rerender();
    expect(getValue().countdown).toEqual({ label: "Trip", date: "2026-08-01" });

    // Let the gate's trailing debounce fire and settle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(state.refresh).toHaveBeenCalledTimes(1);

    // Reconciliation resumes once the gate releases: the next snapshot
    // (reflecting the settled write) now applies.
    state.userSettings = { home_hero_modules: {}, home_hero_countdown: { label: "Trip", date: "2026-08-01" } };
    await rerender();
    expect(getValue().countdown).toEqual({ label: "Trip", date: "2026-08-01" });
  });

  it("does not write when no user is signed in", async () => {
    state.currentUserId = null;
    const { root, getValue } = await renderHook();
    roots.push(root);

    act(() => {
      getValue().setCountdown({ label: "Trip", date: "2026-08-01" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  // Regression for the gate-closure bug: the hook can first mount with no
  // user yet known (mobile mounts while cacheLoading is true; web's guard
  // could move above SummaryHero the same way). The gate must read the
  // CURRENT user id at write time, not whatever was in scope when its
  // closure was first built — a stale closure would silently no-op this
  // write forever, which is exactly what the previous implementation did.
  it("writes once the user becomes known, even though the gate was first built with no user signed in", async () => {
    state.currentUserId = null;
    const { getValue, rerender, root } = await renderHook();
    roots.push(root);

    state.currentUserId = "user-1";
    await rerender();

    act(() => {
      getValue().setCountdown({ label: "Trip", date: "2026-08-01" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toMatchObject({ user_id: "user-1" });
  });
});
