"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";
import { SCREEN_ALT, SCREEN_H, SCREEN_W, screenSrc, type ScreenId } from "./screens";

/** The hero's phone: three real screens in turn, the first one at rest. */
const HERO_SCREENS: readonly ScreenId[] = ["home", "groceries-aisles", "calendar"];
const HOLD_MS = 3600;

export function HeroPhone() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setShown((i) => (i + 1) % HERO_SCREENS.length), HOLD_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className={cn(styles.phone, styles.heroPhone)} role="img" aria-label={SCREEN_ALT[HERO_SCREENS[shown]]}>
      <div className={styles.phoneScreen}>
        {HERO_SCREENS.map((id, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            src={screenSrc(id)}
            alt=""
            width={SCREEN_W}
            height={SCREEN_H}
            decoding="async"
            fetchPriority={i === 0 ? "high" : "auto"}
            className={cn(styles.frame, i === shown && styles.frameOn)}
          />
        ))}
      </div>
    </div>
  );
}
