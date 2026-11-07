// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroLede } from "./hero-lede";

// Hearth §8 "Hero roll": a number that changes rolls; words just show.
describe("HeroLede", () => {
  let container: HTMLDivElement;
  let root: Root;
  const animate = vi.fn((_frames: Keyframe[], _opts?: KeyframeAnimationOptions) => ({ cancel() {}, onfinish: null }));

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    animate.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  const render = (value: string | number) => act(() => root.render(<HeroLede value={value} label="left" />));

  it("rolls the old number away under the new one", () => {
    render(3);
    expect(animate).not.toHaveBeenCalled();
    render(2);
    expect(container.querySelector("h1")!.textContent).toContain("2");
    expect(container.querySelector("[aria-hidden]")!.textContent).toBe("3");
    // The new number drops in from above while the old one falls away.
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0][0]).toEqual([{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }]);
  });

  it("just shows a change to words", () => {
    render(1);
    render("All clear");
    expect(animate).not.toHaveBeenCalled();
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});
