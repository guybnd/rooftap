// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevalidatingIndicator } from "./revalidating-indicator";

const dataCacheState = vi.hoisted(() => ({
  current: { revalidating: false },
}));

vi.mock("@/lib/data-cache", () => ({
  useDataCache: () => dataCacheState.current,
}));

describe("RevalidatingIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    dataCacheState.current = { revalidating: false };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render() {
    await act(async () => {
      root.render(<RevalidatingIndicator />);
    });
  }

  it("renders nothing while idle, and nothing during the first second of a refresh", async () => {
    await render();
    expect(container.textContent).toBe("");

    dataCacheState.current = { revalidating: true };
    await render();
    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(container.textContent).toBe("");
  });

  it("shows the Refreshing chip after the delay and clears it when the refresh ends", async () => {
    dataCacheState.current = { revalidating: true };
    await render();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("Refreshing");
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    dataCacheState.current = { revalidating: false };
    await render();
    expect(container.textContent).toBe("");
  });

  it("HOUP-319: floats over the page instead of sitting in the flow, so content below never shifts", async () => {
    dataCacheState.current = { revalidating: true };
    await render();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // The outer rail is the only thing in the document flow, and it must take
    // no vertical space (sticky + h-0). The chip itself is absolutely
    // positioned inside it. Putting either back in flow reintroduces the jump.
    const rail = container.firstElementChild as HTMLElement;
    expect(rail.dataset.testid).toBe("revalidating-rail");
    expect(rail.classList.contains("sticky")).toBe(true);
    expect(rail.classList.contains("h-0")).toBe(true);
    expect(rail.classList.contains("pointer-events-none")).toBe(true);

    const chip = rail.firstElementChild as HTMLElement;
    expect(chip.getAttribute("role")).toBe("status");
    expect(chip.classList.contains("absolute")).toBe(true);
  });
});
