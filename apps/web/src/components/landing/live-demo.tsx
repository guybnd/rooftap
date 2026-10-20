"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";
import { SCREEN_H, SCREEN_W, screenSrc } from "./screens";

// The live demo: the real web app with the demo household, in a phone frame.
// It loads on a tap, not with the page, and only the static site has it
// (landing-static builds the demo into ./demo).

export function LiveDemo({ href }: { href: string }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / SCREEN_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={cn(styles.phone, styles.livePhone)}>
      <div ref={screen} className={styles.phoneScreen}>
        {open ? (
          <iframe
            title="Rooftap demo"
            src={href}
            className={styles.liveFrame}
            style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` }}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenSrc("home")} alt="" width={SCREEN_W} height={SCREEN_H} loading="lazy" decoding="async" className={styles.livePoster} />
            <button type="button" className={cn(styles.button, styles.liveStart)} onClick={() => setOpen(true)}>
              Open the demo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
