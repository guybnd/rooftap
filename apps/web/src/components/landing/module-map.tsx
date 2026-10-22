"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MODULES, sectionHue } from "@homeup/core";
import { LayoutGrid } from "lucide-react";
import { sectionIcons } from "@/lib/section-icons";
import styles from "./landing.module.css";
import { MAP_LABEL, MAP_LINKS, MAP_MODULES, MAP_TALL, MAP_WIDE, POS, mapSection, type MapLink, type MapModule, type MapShot } from "./module-map-data";
import MARKS from "./screen-marks.json";
import { ringAround, SCREEN_H, SCREEN_W, screenSrc, type MarkRect } from "./screens";

// The module map: every module, every link between two of them. Hover or tap
// a line and the card beside it shows that link with its real screens. Hover
// or tap a module and its lines light while the card lists only its links.
// The modules drift a few units on slow cycles, the lines bend with them and
// sway, and a lit line turns wine red;
// with reduced motion the map stands still.

/** The map switches to its tall layout below this width, in CSS pixels. */
const TALL_BELOW = 600;
/** The height of every crop, in the frame's points. */
const CROP_H = 230;
/** How far a module drifts from its place, in map units. */
const DRIFT = { wide: 5, tall: 2.5 };
/** How far each line's bend sways, at rest and lit, and how fast (radians per ms). */
const SWAY = { rest: 0.025, lit: 0.07, speed: 0.0006, litSpeed: 0.0016 };
/** How far a lit neighbour leans toward the chosen module, as a share of the distance. */
const LEAN = 0.06;

type Pick = { link: number } | { module: MapModule };
type Layout = "wide" | "tall";

const marks = MARKS as unknown as Record<string, Record<string, MarkRect>>;
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/** Each line bends a little to one side, the same way every time. */
const BEND = MAP_LINKS.map((l, i) => (i % 2 ? 1 : -1) * (0.04 + ((l.a.length + l.b.length) % 4) * 0.012));

function ModuleTile({ id }: { id: MapModule }) {
  const Icon = sectionIcons[MODULES.find((m) => m.id === id)?.iconId ?? ""] ?? LayoutGrid;
  return (
    <span className={styles.mapTile} data-hue={sectionHue(mapSection(id))} aria-hidden="true">
      <Icon className="size-3.5" />
    </span>
  );
}

function Chip({ id }: { id: MapModule }) {
  return (
    <span className={styles.mapChip}>
      <ModuleTile id={id} />
      {MAP_LABEL[id]}
    </span>
  );
}

/** A demo frame cropped to the row the link writes, centred on its measured mark. */
function Crop({ shot, hue }: { shot: MapShot; hue: string }) {
  const r = marks[shot.scene]?.[shot.mark];
  const ring = r && ringAround(r);
  const top = r ? Math.round(Math.min(Math.max(r[1] + r[3] / 2 - CROP_H / 2, 0), SCREEN_H - CROP_H)) : 0;
  return (
    <div className={styles.crop} data-hue={hue} style={{ aspectRatio: `${SCREEN_W} / ${CROP_H}` }}>
      {/* A percentage margin is a share of the width, so this moves the frame up by `top` points at any size. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={screenSrc(shot.scene)} alt="" loading="lazy" decoding="async" style={{ marginTop: `-${pct(top, SCREEN_W)}` }} />
      {ring && <span className={styles.cropRing} style={{ left: pct(ring[0], SCREEN_W), top: pct(ring[1] - top, CROP_H), width: pct(ring[2], SCREEN_W), height: pct(ring[3], CROP_H) }} aria-hidden="true" />}
    </div>
  );
}

function LinkCard({ link }: { link: MapLink }) {
  return (
    <>
      <p className={styles.mapCardPair}>
        <Chip id={link.a} />
        <span aria-hidden="true">and</span>
        <Chip id={link.b} />
      </p>
      <p className={styles.mapCardText}>{link.text}</p>
      {link.shots.length > 0 && (
        <div className={styles.mapCrops}>
          {link.shots.map((s) => (
            <Crop key={`${s.scene}-${s.mark}`} shot={s} hue={sectionHue(mapSection(link.b))} />
          ))}
        </div>
      )}
    </>
  );
}

export function ModuleMap() {
  const [pick, setPick] = useState<Pick>({ link: 0 });
  const [layout, setLayout] = useState<Layout>("wide");
  const box = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Partial<Record<MapModule, HTMLButtonElement | null>>>({});
  const pathRefs = useRef<(SVGPathElement | null)[][]>([]);

  const lit = useMemo(() => {
    if ("link" in pick) {
      const l = MAP_LINKS[pick.link];
      return { modules: new Set<MapModule>([l.a, l.b]), links: new Set([pick.link]), focus: null };
    }
    const links = new Set(MAP_LINKS.flatMap((l, i) => (l.a === pick.module || l.b === pick.module ? [i] : [])));
    const modules = new Set<MapModule>([pick.module, ...[...links].flatMap((i) => [MAP_LINKS[i].a, MAP_LINKS[i].b])]);
    return { modules, links, focus: pick.module };
  }, [pick]);

  // The layout follows the map's own width, not the window's.
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayout(el.clientWidth < TALL_BELOW ? "tall" : "wide"));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drift: each module bobs on its own slow cycle, lit neighbours lean toward
  // the chosen module, and every line is redrawn between where its ends are.
  const focus = useRef<MapModule | null>(null);
  const litModules = useRef(lit.modules);
  const litLinks = useRef(lit.links);
  focus.current = lit.focus;
  litModules.current = lit.modules;
  litLinks.current = lit.links;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = layout === "wide" ? MAP_WIDE : MAP_TALL;
    const amp = DRIFT[layout];
    const cur = Object.fromEntries(MAP_MODULES.map((id) => [id, [...POS[id][layout]]])) as Record<MapModule, number[]>;
    const phase = Object.fromEntries(MAP_MODULES.map((id, i) => [id, i * 1.7])) as Record<MapModule, number>;
    let raf = 0;
    let shown = true;

    const frame = (now: number) => {
      const k = el.clientWidth / size.w;
      const f = focus.current ? POS[focus.current][layout] : null;
      for (const id of MAP_MODULES) {
        const [bx, by] = POS[id][layout];
        let tx = bx;
        let ty = by;
        if (!still) {
          const s = 0.00032 + (phase[id] % 0.5) * 0.0001;
          tx += Math.sin(now * s + phase[id]) * amp * 1.3;
          ty += Math.cos(now * s * 1.3 + phase[id] * 1.7) * amp;
        }
        if (f && id !== focus.current && litModules.current.has(id)) {
          tx += (f[0] - bx) * LEAN;
          ty += (f[1] - by) * LEAN;
        }
        const c = cur[id];
        c[0] += (tx - c[0]) * (still ? 1 : 0.08);
        c[1] += (ty - c[1]) * (still ? 1 : 0.08);
        const node = nodeRefs.current[id];
        if (node) node.style.transform = `translate(-50%, -50%) translate(${((c[0] - bx) * k).toFixed(2)}px, ${((c[1] - by) * k).toFixed(2)}px)`;
      }
      MAP_LINKS.forEach((l, i) => {
        const [x1, y1] = cur[l.a];
        const [x2, y2] = cur[l.b];
        // Every line sways a little; a lit one sways more and faster.
        const on = litLinks.current.has(i);
        const bend = BEND[i] + (still ? 0 : Math.sin(now * (on ? SWAY.litSpeed : SWAY.speed) + i * 2.1) * (on ? SWAY.lit : SWAY.rest));
        const cx = (x1 + x2) / 2 - (y2 - y1) * bend;
        const cy = (y1 + y2) / 2 + (x2 - x1) * bend;
        const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        for (const p of pathRefs.current[i] ?? []) p?.setAttribute("d", d);
      });
      if (!still && shown) raf = requestAnimationFrame(frame);
    };

    // Nothing moves while the map is off screen.
    const io = new IntersectionObserver(([entry]) => {
      shown = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (shown) raf = requestAnimationFrame(frame);
    });
    io.observe(el);
    frame(performance.now());
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [layout]);

  const size = layout === "wide" ? MAP_WIDE : MAP_TALL;
  const chosen = "module" in pick ? pick.module : null;
  const moduleLinks = chosen ? MAP_LINKS.map((l, i) => [l, i] as const).filter(([l]) => l.a === chosen || l.b === chosen) : [];

  return (
    <div className={styles.mapGrid}>
      <div className={styles.mapBox}>
        <div ref={box} className={styles.map} data-layout={layout} style={{ aspectRatio: `${size.w} / ${size.h}` }}>
          <svg viewBox={`0 0 ${size.w} ${size.h}`} className={styles.mapLines} aria-hidden="true">
            {MAP_LINKS.map((l, i) => {
              const on = lit.links.has(i);
              const ref = (n: number) => (p: SVGPathElement | null) => {
                (pathRefs.current[i] ??= [])[n] = p;
              };
              return (
                <g key={`${l.a}-${l.b}`} data-on={on || undefined}>
                  <path ref={ref(0)} className={styles.mapGlow} />
                  <path ref={ref(1)} className={styles.mapLine} />
                  <path ref={ref(2)} className={styles.mapHit} onPointerEnter={() => setPick({ link: i })} onClick={() => setPick({ link: i })} />
                </g>
              );
            })}
          </svg>
          {MAP_MODULES.map((id) => {
            const [x, y] = POS[id][layout];
            return (
              <button
                key={id}
                ref={(n) => {
                  nodeRefs.current[id] = n;
                }}
                type="button"
                className={styles.mapNode}
                style={{ left: pct(x, size.w), top: pct(y, size.h) }}
                data-on={lit.modules.has(id) || undefined}
                data-chosen={chosen === id || undefined}
                aria-pressed={chosen === id}
                onPointerEnter={(e) => e.pointerType === "mouse" && setPick({ module: id })}
                onFocus={() => setPick({ module: id })}
                onClick={() => setPick({ module: id })}
              >
                <ModuleTile id={id} />
                {MAP_LABEL[id]}
              </button>
            );
          })}
        </div>
        <p className={styles.mapHint}>Hover or tap a module or a line.</p>
      </div>

      <div className={styles.mapCard} aria-live="polite">
        {"link" in pick ? (
          <LinkCard link={MAP_LINKS[pick.link]} />
        ) : (
          <>
            <p className={styles.mapCardPair}>
              <Chip id={pick.module} />
              <span className={styles.mapCount}>{moduleLinks.length} {moduleLinks.length === 1 ? "link" : "links"}</span>
            </p>
            <ul className={styles.mapList}>
              {moduleLinks.map(([l, i]) => (
                <li key={i}>
                  <button type="button" onClick={() => setPick({ link: i })}>
                    <Chip id={l.a === pick.module ? l.b : l.a} />
                    <span>{l.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
