// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineIndicator } from "./offline-indicator";

// FLUX-150 retired the old hand-rolled sync-queue counter that useDataCache
// used to expose (offline-indicator.tsx:13-17) — totalPending is now
// useLegendPendingCount() alone, so both hooks are mocked independently
// rather than testing a summed count that no longer exists.
const dataCacheState = vi.hoisted(() => ({
  current: { isOnline: true, lastSyncedAt: null as string | null },
}));
const pendingState = vi.hoisted(() => ({ current: 0 }));

vi.mock("@/lib/data-cache", () => ({
  useDataCache: () => dataCacheState.current,
}));

vi.mock("@/lib/legend/sync-status", () => ({
  useLegendPendingCount: () => pendingState.current,
}));

describe("OfflineIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dataCacheState.current = { isOnline: true, lastSyncedAt: null };
    pendingState.current = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function renderIndicator() {
    await act(async () => {
      root.render(<OfflineIndicator />);
    });
  }

  it("renders nothing when online with no pending work and no prior pending state (H1)", async () => {
    await renderIndicator();
    expect(container.textContent).toBe("");
  });

  it("shows the offline banner with the pending count when offline", async () => {
    dataCacheState.current = { isOnline: false, lastSyncedAt: null };
    pendingState.current = 3;

    await renderIndicator();

    expect(container.textContent).toContain("Offline mode");
    expect(container.textContent).toContain("3 pending");
  });

  it("shows the syncing banner when online with pending changes", async () => {
    pendingState.current = 2;

    await renderIndicator();

    expect(container.textContent).toContain("Syncing 2 pending changes");
  });

  it("shows a brief Synced pill after draining to 0 while online, then clears after the confirmation window", async () => {
    vi.useFakeTimers();

    dataCacheState.current = { isOnline: false, lastSyncedAt: null };
    pendingState.current = 3;
    await renderIndicator();
    expect(container.textContent).toContain("Offline mode");

    dataCacheState.current = { isOnline: true, lastSyncedAt: null };
    await renderIndicator();
    expect(container.textContent).toContain("Syncing 3 pending changes");

    pendingState.current = 0;
    await renderIndicator();
    expect(container.textContent).toContain("Synced");

    await act(async () => {
      vi.advanceTimersByTime(2499);
    });
    expect(container.textContent).toContain("Synced");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container.textContent).toBe("");
  });
});
