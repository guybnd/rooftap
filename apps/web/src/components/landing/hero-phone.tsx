"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";
import { DESKTOP_ALT, DESKTOP_H, DESKTOP_SCREEN_IDS, DESKTOP_W, SCREEN_ALT, SCREEN_H, SCREEN_W, desktopScreenSrc, screenSrc, type ScreenId } from "./screens";

/** The hero's phone: three real screens in turn, the first one at rest. A
 * switch above it shows the same app in its wide desktop layout instead. */
const HERO_SCREENS: readonly ScreenId[] = ["home", "groceries-aisles", "calendar"];
const HOLD_MS = 3600;

/**
 * With a demo address (the static site builds the demo into ./demo), a tap
 * swaps the photographs for the real web app with the demo household. It
 * loads on that tap, not with the page.
 */
export function HeroPhone({ demoHref = null }: { demoHref?: string | null }) {
  // Phone or desktop: the same app in its phone layout or its wide layout.
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const desk = device === "desktop";
  const count = desk ? DESKTOP_SCREEN_IDS.length : HERO_SCREENS.length;
  const [shown, setShown] = useState(0);
  const [live, setLive] = useState(false);
  const [scale, setScale] = useState(1);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setShown((i) => (i + 1) % count), HOLD_MS);
    return () => window.clearInterval(id);
  }, [live, count]);
  useEffect(() => {
    const el = screen.current;
    if (!el || !demoHref) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / (desk ? DESKTOP_W : SCREEN_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [demoHref, desk]);
  const pick = (next: "phone" | "desktop") => {
    setDevice(next);
    setShown(0);
  };

  // Full screen: the live demo's own frame fills the screen, so the demo keeps
  // what was changed in it and lays itself out for the screen's width. The
  // frame mounts first if the demo is not live yet, inside the same tap.
  // Where a page cannot go full screen (iPhone Safari), the demo opens in a
  // new tab instead.
  const frame = useRef<HTMLIFrameElement>(null);
  const fullScreen = () => {
    if (!demoHref) return;
    if (!live) flushSync(() => setLive(true));
    const el = frame.current;
    if (el?.requestFullscreen && document.fullscreenEnabled) el.requestFullscreen().catch(() => window.open(demoHref, "_blank", "noopener"));
    else window.open(demoHref, "_blank", "noopener");
  };
  const hint =
    demoHref &&
    (
      <div className={styles.liveRow}>
        {live ? (
          <p className={styles.liveHint}>Demo household. Changes stay until you reload.</p>
        ) : (
          <button type="button" className={styles.liveHint} onClick={() => setLive(true)}>
            <span className={styles.liveDot} aria-hidden="true" />
            Try it yourself
          </button>
        )}
        <button type="button" className={styles.fullButton} onClick={fullScreen} aria-label="Open the demo full screen" title="Full screen">
          <Maximize2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    );

  const switcher = (
    <div className={styles.deviceSwitch} role="group" aria-label="Layout">
      {(["phone", "desktop"] as const).map((d) => (
        <button key={d} type="button" aria-pressed={device === d} onClick={() => pick(d)} className={cn(styles.deviceOption, device === d && styles.deviceOn)}>
          {d === "phone" ? "Phone" : "Desktop"}
        </button>
      ))}
    </div>
  );

  if (desk) {
    const browser = (
      <div className={styles.browser} role={live ? undefined : "img"} aria-label={live ? undefined : DESKTOP_ALT[DESKTOP_SCREEN_IDS[shown]]}>
        <div className={styles.browserBar} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div ref={screen} className={styles.browserScreen}>
          {live && demoHref ? (
            <iframe ref={frame} title="Rooftap demo" src={demoHref} className={styles.liveFrame} style={{ width: DESKTOP_W, height: DESKTOP_H, transform: `scale(${scale})` }} />
          ) : (
            DESKTOP_SCREEN_IDS.map((id, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={id}
                src={desktopScreenSrc(id)}
                alt=""
                width={DESKTOP_W}
                height={DESKTOP_H}
                decoding="async"
                loading={i === 0 ? "eager" : "lazy"}
                className={cn(styles.frame, i === shown && styles.frameOn)}
              />
            ))
          )}
          {demoHref && !live && <button type="button" className={styles.liveCover} onClick={() => setLive(true)} aria-label="Try the app with a demo household" />}
        </div>
      </div>
    );
    return (
      <div className={cn(styles.heroDemo, styles.heroDesktop)}>
        {switcher}
        {hint}
        {browser}
      </div>
    );
  }

  const phone = (
    <div className={cn(styles.phone, styles.heroPhone)} role={live ? undefined : "img"} aria-label={live ? undefined : SCREEN_ALT[HERO_SCREENS[shown]]}>
      <div ref={screen} className={styles.phoneScreen}>
        {live && demoHref ? (
          <iframe ref={frame} title="Rooftap demo" src={demoHref} className={styles.liveFrame} style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` }} />
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
  if (!demoHref)
    return (
      <div className={styles.heroDemo}>
        {switcher}
        {phone}
      </div>
    );
  return (
    <div className={styles.heroDemo}>
      {switcher}
      {hint}
      {phone}
    </div>
  );
}
