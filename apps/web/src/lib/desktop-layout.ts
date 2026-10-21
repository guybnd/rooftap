"use client";

// Hearth §13 "Desktop shell": on a wide screen the web app runs under a top
// bar with boards below it. Anyone who prefers the old side bar can switch
// back in Settings > Appearance. It is a per-browser choice (a wide laptop
// and a phone can differ), kept in localStorage and mirrored onto
// <html data-layout> so the shell paints the right chrome before hydration
// (the boot script in app/layout.tsx sets the attribute; globals.css shows
// `.desk-top` or `.desk-classic`).
import { useSyncExternalStore } from "react";
import { DESKTOP_LAYOUT_STORAGE_KEY } from "./desktop-layout-key";

export { DESKTOP_LAYOUT_STORAGE_KEY };

export type DesktopLayout = "top" | "classic";

/** Where the top bar takes over from the phone chrome (Tailwind `md`). */
export const DESKTOP_MIN_WIDTH = 768;
/** Where pages switch to their wide boards (Tailwind `lg`). */
export const WIDE_MIN_WIDTH = 1024;

const listeners = new Set<() => void>();

function readLayout(): DesktopLayout {
  try {
    return window.localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY) === "classic" ? "classic" : "top";
  } catch {
    return "top";
  }
}

export function setDesktopLayout(layout: DesktopLayout) {
  try {
    if (layout === "classic") window.localStorage.setItem(DESKTOP_LAYOUT_STORAGE_KEY, "classic");
    else window.localStorage.removeItem(DESKTOP_LAYOUT_STORAGE_KEY);
  } catch {
    // Storage blocked: the switch still applies until the tab closes.
  }
  if (layout === "classic") document.documentElement.setAttribute("data-layout", "classic");
  else document.documentElement.removeAttribute("data-layout");
  current = layout;
  listeners.forEach((l) => l());
}

let current: DesktopLayout | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDesktopLayout(): DesktopLayout {
  return useSyncExternalStore(
    subscribe,
    () => (current ??= readLayout()),
    () => "top"
  );
}

/** A CSS media query's match, live. False on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** True where pages lay out as wide boards: the top-bar layout on a screen at least `lg` wide. */
export function useWideLayout(): boolean {
  const layout = useDesktopLayout();
  const wide = useMediaQuery(`(min-width: ${WIDE_MIN_WIDTH}px)`);
  return layout === "top" && wide;
}
