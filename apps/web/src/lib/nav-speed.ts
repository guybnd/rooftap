"use client";

// The device's navigation speed (core nav-speed.ts) as a CSS variable on the
// root, so the page shift, the glow and anything else on --motion-nav follow
// it. Mounted once by the app shell.
import { useEffect } from "react";
import { NAV_SPEED_MS, useNavSpeed } from "@homeup/core";

export function useApplyNavSpeed(): void {
  const speed = useNavSpeed();
  useEffect(() => {
    document.documentElement.style.setProperty("--nav-speed-ms", `${NAV_SPEED_MS[speed]}ms`);
  }, [speed]);
}
