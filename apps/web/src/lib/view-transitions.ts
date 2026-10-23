"use client";

// Hearth §8.1 "Navigation choreography" — thin wrapper around the browser's
// View Transitions API (no React `<ViewTransition>` component: that export
// requires a react@canary build and this repo pins stable react@19, so the
// imperative `document.startViewTransition()` API is the supported surface).
// Unsupported browsers (iOS Safari, older Chrome), `prefers-reduced-motion`
// and the e-paper theme fall through to a plain instant navigation — see
// globals.css, whose `--motion-*` tokens also collapse to 0ms under both.

import type { MouseEvent } from "react";
import type { useRouter } from "next/navigation";
import { ARRIVE, arriveDelayMs } from "@homeup/core";
import { prefersStillMotion } from "./still-motion";

export type NavTransitionType = "crossfade" | "shift-forward" | "shift-back" | "descend" | "back" | "portal";

type Router = ReturnType<typeof useRouter>;

// Resolves once the in-flight transition's navigation has committed the new
// route (see useNavTransitionSettle, mounted once near the app root).
let pendingResolve: (() => void) | null = null;

// The transition currently in flight, if any — exposed so a destination page
// can hook cleanup (e.g. clearing a transiently-tagged portal name) into its
// `finished` promise. See clearPortalMorphOnSettle below.
let activeTransition: ReturnType<typeof document.startViewTransition> | null = null;

function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function";
}

/**
 * Call from a `useEffect(() => notifyRouteSettled(), [pathname])` mounted
 * once near the app root (app-sidebar.tsx already re-renders on every route
 * change via `usePathname()`) so a pending view transition's promise
 * resolves right after the new route's DOM has committed, instead of
 * guessing a timeout.
 */
export function notifyRouteSettled(): void {
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve();
  }
  releaseNavHold?.();
}

// A tab switch's page held empty while it slides (see runNavTransition's
// `holdUntilSlid`); releases it once the new route has committed.
let releaseNavHold: (() => void) | null = null;

// Shows the held page even if its route never reports in.
const NAV_HOLD_MAX_MS = 3000;

// The held page shows once both have happened: its route committed
// (notifyRouteSettled) and its slide finished.
let slideLanded: (() => void) | null = null;

let holdId = 0;

function holdNavContent(target: string | undefined): void {
  const root = document.documentElement;
  const id = ++holdId;
  root.dataset.navHold = "";
  const timer = setTimeout(() => show(), NAV_HOLD_MAX_MS);
  let routed = false;
  let landed = false;
  slideLanded = () => {
    landed = true;
    if (routed) show();
  };
  releaseNavHold = () => {
    // A route from an earlier, superseded tap may commit meanwhile.
    if (target && window.location.pathname !== target) return;
    routed = true;
    if (landed) show();
  };
  const show = () => {
    if (id !== holdId) return;
    releaseNavHold = null;
    slideLanded = null;
    clearTimeout(timer);
    delete root.dataset.navHold;
    // Same task as the unhide, so nothing paints before the cascade holds it.
    const region = document.querySelector<HTMLElement>(".route-transition-region");
    if (region) revealCascade(region);
  };
}

// Hearth §8.1 "Arrive": a page that lands after a tab switch fills in as a
// cascade, its blocks fading and rising into place one after another from
// the top, instead of appearing at once. Transform and opacity only, so it
// stays smooth while the page is still settling.
// Timing shared with native (core ARRIVE); at most this many blocks.
const ARRIVE_MAX_BLOCKS = 16;

/**
 * The page's visible blocks in reading order: wrappers are walked through,
 * and a tall plain container (a column, a grid) is split into its parts, so
 * the cascade runs card by card, not page by page. Anything with its own
 * surface (a card: background, border or shadow) arrives as one block.
 */
function arriveBlocks(root: HTMLElement): HTMLElement[] {
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < viewH && r.right > 0 && r.left < viewW;
  };
  const surface = (el: Element) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    return (
      (!!bg && bg !== "transparent" && !/,\s*0\)$/.test(bg)) ||
      cs.boxShadow !== "none" ||
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderBottomWidth) > 0
    );
  };
  const out: HTMLElement[] = [];
  const visit = (node: HTMLElement, depth: number) => {
    const kids = [...node.children].filter((k): k is HTMLElement => k instanceof HTMLElement && shown(k));
    if (kids.length === 0 || depth > 16) {
      out.push(node);
      return;
    }
    if (kids.length === 1 && !surface(kids[0])) return visit(kids[0], depth + 1);
    for (const k of kids) {
      if (!surface(k) && k.children.length > 0 && k.getBoundingClientRect().height > viewH * 0.35) visit(k, depth + 1);
      else out.push(k);
    }
  };
  visit(root, 0);
  return out
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => Math.round(a.r.top / 24) - Math.round(b.r.top / 24) || a.r.left - b.r.left)
    .map(({ el }) => el)
    .slice(0, ARRIVE_MAX_BLOCKS);
}

function revealCascade(region: HTMLElement): void {
  if (prefersStillMotion() || typeof region.animate !== "function") return;
  arriveBlocks(region).forEach((el, i) => {
    el.animate(
      [
        { opacity: 0, transform: `translateY(${ARRIVE.risePx}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: ARRIVE.durationMs,
        delay: arriveDelayMs(i),
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      }
    );
  });
}

/**
 * Run `navigate` (a router.push/replace/back call) inside a View Transition
 * tagged `type`. `type` is written to `<html data-nav-transition>` for the
 * transition's lifetime so globals.css can style `::view-transition-*` per
 * behavior without touching app-sidebar.tsx's own transform/filter
 * transition on the sheet page-behind (separate compositing layer — no
 * competing transform on the same element, FLUX-1553 reground caveat).
 */
export function runNavTransition(
  type: NavTransitionType,
  navigate: () => void,
  {
    holdUntilSlid = false,
    target,
    onStart,
  }: { holdUntilSlid?: boolean; target?: string; onStart?: () => void } = {}
): void {
  if (!supportsViewTransitions() || prefersStillMotion()) {
    navigate();
    return;
  }
  const root = document.documentElement;
  root.dataset.navTransition = type;
  if (holdUntilSlid) {
    // A tab switch slides at once and renders the new page after: waiting
    // for its render first froze the old page for 0.1-1s before anything
    // moved, and the render landing mid-slide stalled the pebble and the
    // glow. The page slides in empty over the ground, then fills in.
    // `onStart` runs as the new state is captured, so chrome that follows
    // the destination (the bar's pebble, the glow) moves with the slide.
    // The route renders while the page slides (hidden), and shows when both
    // are done.
    const transition = document.startViewTransition(() => {
      holdNavContent(target);
      onStart?.();
    });
    activeTransition = transition;
    void transition.ready.then(navigate, navigate);
    void transition.finished.finally(() => {
      if (activeTransition !== transition) return; // a later tap took over
      delete root.dataset.navTransition;
      activeTransition = null;
      slideLanded?.();
    });
    return;
  }
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          if (pendingResolve === settle) pendingResolve = null;
          clearTimeout(timeoutId);
          resolve();
        };
        pendingResolve = settle;
        // Belt-and-braces (FLUX-1553 review): a same-route navigation (e.g.
        // re-tapping the already-active tab) never changes `pathname`, so
        // the `[pathname]` effect that calls notifyRouteSettled() never
        // re-fires and this promise would hang forever — freezing the app
        // on the stale ::view-transition-old snapshot. This anti-hang net
        // must NOT race a real route commit (a prior double-rAF backstop did
        // exactly that and truncated the crossfade/descend/portal animations
        // on mobile — FLUX-1553 review), so it fires well after any genuine
        // navigation settles: 500ms is comfortably longer than an RSC render
        // + effect commit on a mobile CPU, so notifyRouteSettled() always
        // wins and captures the correct "new" snapshot. The timeout only
        // unsticks a genuine same-path/query-only hang, where old and new
        // are the same page anyway so a late settle is invisible.
        const timeoutId = setTimeout(settle, 500);
        navigate();
      })
  );
  activeTransition = transition;
  void transition.finished.finally(() => {
    if (root.dataset.navTransition === type) delete root.dataset.navTransition;
    if (activeTransition === transition) activeTransition = null;
  });
}

/**
 * How far into its slide (ms) the page is during a tab switch's Shift
 * transition, read off the incoming page's own animation: 0 while the
 * transition is waiting on the new route or its animation hasn't started,
 * null when no Shift is in flight. The tab bar's pebble reads its glide from
 * this so the two move as one (Hearth §8 "Tab glide").
 */
export function navShiftElapsedMs(): number | null {
  if (typeof document === "undefined" || !document.documentElement.dataset.navTransition?.startsWith("shift-")) {
    return null;
  }
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    if (effect?.pseudoElement !== "::view-transition-new(route-content)") continue;
    const time = animation.currentTime;
    return typeof time === "number" ? time : 0;
  }
  return 0;
}

/**
 * Register `el` to have its `view-transition-name` cleared once the
 * currently in-flight transition settles, provided the name hasn't already
 * changed by then. Call this right after tagging a destination element with
 * a shared portal-morph name (Hearth PC5) so the name doesn't linger on the
 * element for the *next* navigation, which would detach it from that next
 * transition's page-level group (FLUX-1553 review, Major finding).
 */
export function clearPortalMorphOnSettle(el: HTMLElement, name: string): void {
  if (!activeTransition) return;
  void activeTransition.finished.finally(() => {
    if (el.style.viewTransitionName === name) el.style.viewTransitionName = "";
  });
}

/**
 * Intercept a plain-left-click on a `<Link>` and replay it through
 * `runNavTransition`, preserving modifier-click / middle-click / right-click
 * default browser behavior (new tab, etc.) by only ever preventing default
 * on an unmodified primary click.
 */
export function navLinkClickHandler(
  type: NavTransitionType,
  router: Router,
  href: string
): (e: MouseEvent<HTMLAnchorElement>) => void {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Same-route link (FLUX-1553 review): skip the transition entirely
    // rather than relying only on the settle fallback above — avoids a
    // pointless transition/rAF round-trip for a navigation that changes
    // nothing.
    if (typeof window !== "undefined" && href === window.location.pathname) return;
    runNavTransition(type, () => router.push(href));
  };
}

/**
 * Tag `el` with a shared `view-transition-name` right before navigating, so
 * the browser morphs it into whatever destination element carries the same
 * name (Hearth PC5 portal jump). No-ops on unsupported browsers. Call this
 * immediately before `runNavTransition("portal", ...)` in the same click
 * handler — the name only needs to survive long enough for that transition's
 * "old" snapshot to be captured, and a unique per-item name (e.g.
 * `portal-recipe-${id}`) means a stale leftover can never collide with a
 * later transition's name.
 */
export function tagPortalMorph(el: HTMLElement | null, name: string): void {
  if (!el || !supportsViewTransitions()) return;
  el.style.viewTransitionName = name;
}
