"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";
import { SCREEN_ALT, SCREEN_H, SCREEN_W, screenSrc, type ScreenId } from "./screens";

/** The hero's phone: three real screens in turn, the first one at rest. */
const HERO_SCREENS: readonly ScreenId[] = ["home", "groceries-aisles", "calendar"];
const HOLD_MS = 3600;

/**
 * With a demo address (the static site builds the demo into ./demo), a tap
 * swaps the photographs for the real web app with the demo household. It
 * loads on that tap, not with the page.
 */
export function HeroPhone({ demoHref = null }: { demoHref?: string | null }) {
  const [shown, setShown] = useState(0);
  const [live, setLive] = useState(false);
  const [scale, setScale] = useState(1);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setShown((i) => (i + 1) % HERO_SCREENS.length), HOLD_MS);
    return () => window.clearInterval(id);
  }, [live]);
  useEffect(() => {
    const el = screen.current;
    if (!el || !demoHref) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / SCREEN_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [demoHref]);

  const phone = (
    <div className={cn(styles.phone, styles.heroPhone)} role={live ? undefined : "img"} aria-label={live ? undefined : SCREEN_ALT[HERO_SCREENS[shown]]}>
      <div ref={screen} className={styles.phoneScreen}>
        {live && demoHref ? (
          <iframe title="Rooftap demo" src={demoHref} className={styles.liveFrame} style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` }} />
        ) : (
          HERO_SCREENS.map((id, i) => (
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
          ))
        )}
        {demoHref && !live && <button type="button" className={styles.liveCover} onClick={() => setLive(true)} aria-label="Try the app with a demo household" />}
      </div>
    </div>
  );
  if (!demoHref) return phone;
  return (
    <div className={styles.heroDemo}>
      {live ? (
        <p className={styles.liveHint}>Demo household. Changes stay until you reload.</p>
      ) : (
        <button type="button" className={styles.liveHint} onClick={() => setLive(true)}>
          <span className={styles.liveDot} aria-hidden="true" />
          Try it yourself
        </button>
      )}
      {phone}
    </div>
  );
}
