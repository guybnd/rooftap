import { useEffect, useState } from "react";

/**
 * Tracks how many pixels the on-screen keyboard — plus any autofill/suggestion
 * bar that spawns on top of it — currently covers at the bottom of the layout
 * viewport, via the VisualViewport API. Returns 0 when no keyboard is shown or
 * the API is unavailable.
 *
 * Why a live listener and not a one-shot measure: the autofill/suggestion bar
 * appears a beat AFTER the keyboard and grows the occluded height. Because we
 * re-measure on every visualViewport `resize`/`scroll`, that second change is
 * reported too — so a bottom-anchored surface can float above the *current*
 * occluded height instead of the initial keyboard-only height.
 *
 * On browsers that reflow the layout for the keyboard (Chrome/Android with
 * `interactive-widget: resizes-content`) `innerHeight` shrinks in lockstep with
 * the visual viewport, so this reports ~0 and the surface's normal `bottom-0`
 * already clears the keyboard. On iOS Safari the layout viewport does not
 * shrink, so this reports the true overlap and the caller offsets manually.
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      // Gap between the layout viewport bottom and the visible (visual) viewport
      // bottom — i.e. the height currently occluded by the keyboard + autofill bar.
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(overlap)));
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return inset;
}
