"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sectionHue } from "@homeup/core";
import { cn } from "@/lib/utils";
import { SectionTile } from "./cards";
import styles from "./landing.module.css";
import MARKS from "./screen-marks.json";
import { ringAround, SCREEN_ALT, SCREEN_H, SCREEN_W, screenSrc, type MarkRect, type ScreenId } from "./screens";
import { clamp, cssColorToHex, lerp, type Pointer } from "./scenes/shared";
import type { Rect as PxRect, StreamsScene } from "./scenes/streams";

// A story is a few steps. Each step puts one or two phones on the stage,
// each showing a real app screen (or a drawn screen, for the chat), and a
// list of features. A feature can point at a spot on a phone, or play a
// short timeline there: a finger taps or swipes, a screen changes, the other
// phone pops with the result. The features play in turn, and only one is lit
// at a time: its row, its ring and (side by side) one line to the spot on the
// phone. A mouse over another feature lights that one instead. A click on a
// feature plays it again. The stage is sticky; the page's scroll picks the
// module, one screen of scroll each; its steps play in turn on their own. A
// chip per module along the top jumps to it, and the step tabs under the
// chips jump to a step.

/** A real screen by id, or a drawn one. */
export type Screen = ScreenId | { node: ReactNode; label: string };
export type Slot = "a" | "b";
/** x, y, w, h in the frame's 390 by 844 points. */
export type Rect = readonly [number, number, number, number];
/** A measured thing on a frame (screen-marks.json, written by scripts/landing-screens.mjs). */
export interface Mark {
  scene: ScreenId;
  mark: string;
}
export type Target = Mark | Rect;
/** A spot on one of the phones. `row` widens a measured line of text to its whole row. */
export interface Spot {
  on: Slot;
  rect: Target;
  row?: boolean;
  /** Points to grow the ring on every side, past its measured room. */
  pad?: number;
}

export type PlayEvent = { at: number } & (
  | { tap: Target; on?: Slot }
  | { swipe: Target; dx: number; on?: Slot }
  | { show: Partial<Record<Slot, Screen>> }
  | { pop: Slot }
  | { highlight: Spot | null }
);

export interface Feature {
  name: string;
  text: string;
  /** Where this feature lives on the phone: ringed the whole time, lit when the feature is. */
  target?: Spot;
  /** What this feature does, from its own start in milliseconds. */
  play?: readonly PlayEvent[];
}

export interface Step {
  title: string;
  features: readonly Feature[];
  /** Shown above the title. */
  lead?: ReactNode;
  /** Shown under the features. */
  after?: ReactNode;
  a: Screen;
  b?: Screen;
  /** A timeline for a step whose features have none of their own. */
  play?: readonly PlayEvent[];
}

export interface Story {
  id: string;
  /** The section whose hue lights the stage and whose tile names it. */
  room: string;
  label: string;
  /** The module's name, on its chip and in the nav's module menu. */
  name: string;
  steps: readonly Step[];
}

/** The id of a story's anchor on the page, for links to it. */
export const storyAnchor = (story: Story) => `story-${story.id}`;

const marks = MARKS as unknown as Record<string, Record<string, MarkRect>>;

/** The measured mark a target names, with its room for a ring; a hand-written rect has none. */
function markOf(target: Target, row = false): MarkRect {
  if (Array.isArray(target)) return target as Rect;
  const m = target as Mark;
  const r = marks[m.scene]?.[m.mark];
  if (!r) return [SCREEN_W / 2 - 20, SCREEN_H / 2 - 20, 40, 40];
  // A measured line of text becomes its whole row: the row or card the shoot
  // script found around it, else the full width at the line's height.
  if (row) return marks[m.scene]?.[`${m.mark}@row`] ?? [12, r[1] - 14, SCREEN_W - 24, r[3] + 28];
  return r;
}
const rectOf = (target: Target, row = false): Rect => markOf(target, row).slice(0, 4) as unknown as Rect;
/** A pin or highlight rings its mark with room to spare, so no ring sits on what it rings or on its neighbours. */
const spotRect = (s: Spot): Rect => ringAround(markOf(s.rect, s.row ?? false), s.pad ?? 0);

const isId = (s: Screen): s is ScreenId => typeof s === "string";
const screenKey = (s: Screen) => (isId(s) ? s : s.label);
const screenLabel = (s: Screen) => (isId(s) ? SCREEN_ALT[s] : s.label);

const rectIn = (el: Element, within: Element): PxRect => {
  const r = el.getBoundingClientRect();
  const s = within.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
};

interface Touch {
  on: Slot;
  rect: Rect;
  kind: "tap" | "swipe";
  dx: number;
  key: number;
}
interface Highlight {
  on: Slot;
  rect: Rect;
}
interface Pin {
  i: number;
  on: Slot;
  rect: Rect;
  /** The frame the pin was measured on; it shows only while that frame does. */
  scene?: ScreenId;
}

/** After a feature's last event, before the next feature starts. */
const SEGMENT_PAUSE = 1900;
/** How long a feature that only points at a spot stays lit. */
const TARGET_HOLD = 2200;
/** After the last feature, before the next step. */
const LOOP_PAUSE = 2400;
/** How long a step with nothing to play stays up. */
const STILL_HOLD = 6000;

interface Segment {
  lit: number;
  events: readonly PlayEvent[];
  length: number;
}

/** The features that do something, in order; or the step's own timeline. */
function segmentsOf(step: Step): Segment[] {
  const end = (events: readonly PlayEvent[]) => events.reduce((m, ev) => Math.max(m, ev.at), 0);
  const segs: Segment[] = [];
  step.features.forEach((f, i) => {
    if (f.play?.length) segs.push({ lit: i, events: f.play, length: end(f.play) + SEGMENT_PAUSE });
    else if (f.target) segs.push({ lit: i, events: [], length: TARGET_HOLD });
  });
  if (!segs.length && step.play?.length) segs.push({ lit: -1, events: step.play, length: end(step.play) + SEGMENT_PAUSE });
  return segs;
}

export interface Replay {
  step: Step;
  feature: number;
  key: number;
}

/** How long a step plays, from the segment it starts at; the step tab's bar fills over it. */
function stepLength(step: Step, from = 0): number {
  const segs = segmentsOf(step).slice(from);
  if (!segs.length) return STILL_HOLD;
  return (from === 0 ? 500 : 0) + segs.reduce((t, seg) => t + seg.length, 0) + LOOP_PAUSE - SEGMENT_PAUSE;
}

/** Where a replay starts in its step's segments; 0 when it is not this step's. */
const replayFrom = (step: Step, replay: Replay | null) => (replay && replay.step === step ? Math.max(0, segmentsOf(step).findIndex((s) => s.lit === replay.feature)) : 0);

/**
 * Plays a step's timeline: the screens, the lit feature, the finger, the
 * highlight, the pops. At the end it calls onEnd, which moves to the next
 * step; `round` restarts the same step (a one-step module plays again).
 */
function useTimeline(step: Step, active: boolean, replay: Replay | null, round: number, onEnd: () => void) {
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [screens, setScreens] = useState<Record<Slot, Screen | undefined>>({ a: step.a, b: step.b });
  const [lit, setLit] = useState(-1);
  const [touch, setTouch] = useState<Touch | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [pop, setPop] = useState<{ on: Slot; key: number } | null>(null);

  useEffect(() => {
    setScreens({ a: step.a, b: step.b });
    setLit(-1);
    setTouch(null);
    setHighlight(null);
    setPop(null);
    if (!active) return;
    const segs = segmentsOf(step);
    const timers: number[] = [];
    if (!segs.length) {
      timers.push(window.setTimeout(() => onEndRef.current(), STILL_HOLD));
      return () => timers.forEach(clearTimeout);
    }
    let key = 0;
    const apply = (ev: PlayEvent) => {
      key += 1;
      if ("tap" in ev) setTouch({ on: ev.on ?? "a", rect: rectOf(ev.tap), kind: "tap", dx: 0, key });
      else if ("swipe" in ev) setTouch({ on: ev.on ?? "a", rect: rectOf(ev.swipe), kind: "swipe", dx: ev.dx, key });
      else if ("show" in ev) setScreens((s) => ({ ...s, ...ev.show }));
      else if ("pop" in ev) setPop({ on: ev.pop, key });
      else if ("highlight" in ev) setHighlight(ev.highlight ? { on: ev.highlight.on, rect: spotRect(ev.highlight) } : null);
    };
    const schedule = (from: number) => {
      // The screens as the earlier features left them, so a replay starts in the right state.
      let shown: Record<Slot, Screen | undefined> = { a: step.a, b: step.b };
      for (const seg of segs.slice(0, from)) for (const ev of seg.events) if ("show" in ev) shown = { ...shown, ...ev.show };
      setScreens(shown);
      setTouch(null);
      setHighlight(null);
      let t = from === 0 ? 500 : 0;
      for (let i = from; i < segs.length; i++) {
        const seg = segs[i];
        timers.push(
          window.setTimeout(() => {
            setLit(seg.lit);
            setTouch(null);
            setHighlight(null);
          }, t)
        );
        for (const ev of seg.events) timers.push(window.setTimeout(() => apply(ev), t + ev.at));
        t += seg.length;
      }
      timers.push(window.setTimeout(() => onEndRef.current(), t + LOOP_PAUSE - SEGMENT_PAUSE));
    };
    schedule(replayFrom(step, replay));
    return () => timers.forEach(clearTimeout);
  }, [step, active, replay, round]);

  return { screens, lit, touch, highlight, pop };
}

const pct = (r: Rect) => ({ left: `${(r[0] / SCREEN_W) * 100}%`, top: `${(r[1] / SCREEN_H) * 100}%`, width: `${(r[2] / SCREEN_W) * 100}%`, height: `${(r[3] / SCREEN_H) * 100}%` });

/** One phone: a stack of the screens it can show, the active on top, with the pins, the finger and the highlight over it. */
function Phone({
  slot,
  screens,
  shown,
  pins,
  shownFeature,
  touch,
  highlight,
  pop,
  phoneRef,
  pinRef,
  highlightRef,
  eager,
}: {
  slot: Slot;
  screens: readonly Screen[];
  shown: Screen | undefined;
  pins: readonly Pin[];
  /** The one feature that is lit: the hovered one, else the playing one. */
  shownFeature: number;
  touch: Touch | null;
  highlight: Highlight | null;
  pop: { on: Slot; key: number } | null;
  phoneRef: (el: HTMLDivElement | null) => void;
  pinRef: (i: number, el: HTMLSpanElement | null) => void;
  highlightRef: (el: HTMLSpanElement | null) => void;
  eager: boolean;
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  const popping = pop && pop.on === slot ? pop.key : 0;
  // The pop is a Web Animation on the same element, not a remount: a remount
  // would reload every frame in the stack and show black while they come back.
  useEffect(() => {
    const el = screenRef.current;
    if (!popping || !el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const anim = el.animate(
      [
        { transform: "scale(1)", boxShadow: "0 0 0 0 var(--hue-glow)" },
        { transform: "scale(1.035)", boxShadow: "0 0 0 3px var(--hue-glow)", offset: 0.35 },
        { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
      ],
      { duration: 640, easing: "cubic-bezier(0.2, 0.9, 0.2, 1.2)" }
    );
    return () => anim.cancel();
  }, [popping]);
  if (!shown) return null;
  const t = touch && touch.on === slot ? touch : null;
  const h = highlight && highlight.on === slot ? highlight : null;
  return (
    <div ref={phoneRef} className={styles.phone} role="img" aria-label={screenLabel(shown)}>
      <div ref={screenRef} className={styles.phoneScreen}>
        {screens.map((s, i) =>
          isId(s) ? (
            // The frames are photographs of the app shot by scripts/landing-screens.mjs.
            // Every frame of the story loads at once, so a screen change never shows black.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={s}
              src={screenSrc(s)}
              alt=""
              width={SCREEN_W}
              height={SCREEN_H}
              decoding="async"
              loading="eager"
              fetchPriority={eager && i === 0 ? "high" : "auto"}
              className={cn(styles.frame, screenKey(s) === screenKey(shown) && styles.frameOn)}
            />
          ) : (
            <div key={s.label} className={cn(styles.frame, styles.drawn, screenKey(s) === screenKey(shown) && styles.frameOn)} aria-hidden={screenKey(s) !== screenKey(shown)}>
              {s.node}
            </div>
          )
        )}
        {pins
          // A feature that plays can show another frame first, and a pin measured on a frame must not ring that one.
          .filter((p) => p.on === slot && (!p.scene || p.scene === shown))
          .map((p) => (
            <span key={p.i} ref={(el) => pinRef(p.i, el)} className={cn(styles.pin, p.i === shownFeature && styles.pinOn)} style={pct(p.rect)} aria-hidden="true" />
          ))}
        {h && <span ref={highlightRef} className={styles.highlight} style={pct(h.rect)} aria-hidden="true" />}
        {t && (
          <span
            key={t.key}
            className={cn(styles.finger, t.kind === "swipe" ? styles.fingerSwipe : styles.fingerTap)}
            style={{ left: `${((t.rect[0] + t.rect[2] / 2) / SCREEN_W) * 100}%`, top: `${((t.rect[1] + t.rect[3] / 2) / SCREEN_H) * 100}%`, ["--dx" as string]: `${(t.dx / SCREEN_W) * 100}cqw` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

/** The screens a slot shows anywhere in a story, so they are all in the DOM and preloaded. */
function screensFor(story: Story, slot: Slot): Screen[] {
  const seen = new Map<string, Screen>();
  const add = (s: Screen | undefined) => {
    if (s && !seen.has(screenKey(s))) seen.set(screenKey(s), s);
  };
  const addEvents = (events?: readonly PlayEvent[]) => {
    for (const ev of events ?? []) if ("show" in ev) add(ev.show[slot]);
  };
  for (const step of story.steps) {
    add(step[slot]);
    addEvents(step.play);
    for (const f of step.features) addEvents(f.play);
  }
  return [...seen.values()];
}

const playable = (f: Feature) => !!(f.play?.length || f.target);

interface Flat {
  story: Story;
  storyIndex: number;
  step: Step;
}

/**
 * A line from a feature to its spot on the phone. Side by side (desktop), it
 * leaves the right edge of the feature list (one x for every line) and
 * curves into the spot's facing edge, on its middle line. Stacked
 * (phone, the screens above the caption), it leaves the feature's corner,
 * runs up the margin beside the phone and turns into the spot's side, so it
 * never crosses the screen.
 */
function linePath(from: PxRect, to: PxRect, within: PxRect, startX?: number): string {
  const fromCx = from.x + from.w / 2;
  const fromCy = from.y + from.h / 2;
  const toCx = to.x + to.w / 2;
  const toCy = to.y + to.h / 2;
  if (Math.abs(toCx - fromCx) > Math.abs(toCy - fromCy) * 1.2) {
    const dir = toCx > fromCx ? 1 : -1;
    // Every line of a caption leaves from one x, the right edge of its list.
    const x1 = dir > 0 ? (startX ?? from.x + from.w) + 4 : from.x - 4;
    const x2 = dir > 0 ? to.x - 3 : to.x + to.w + 3;
    const cx = (x1 + x2) / 2;
    return `M${x1} ${fromCy} C${cx} ${fromCy} ${cx} ${toCy} ${x2} ${toCy}`;
  }
  // Up the left margin into the spot's left side, or up the right margin when the spot sits right of centre.
  const right = toCx > within.w / 2;
  const x0 = right ? from.x + from.w - 10 : from.x + 10;
  const y1 = from.y - 2;
  const x2 = right ? to.x + to.w + 3 : to.x - 3;
  const r = Math.min(14, Math.abs(x2 - x0), Math.abs(y1 - toCy));
  const sx = right ? -1 : 1;
  return `M${x0} ${y1} L${x0} ${toCy + r} Q${x0} ${toCy} ${x0 + sx * r} ${toCy} L${x2} ${toCy}`;
}

/**
 * One sticky stage that a tall scroll run plays through every story: the
 * scroll picks the story, its steps play their features in turn, and between
 * stories the room's colour moves first and the next phones flip in. three.js
 * draws the light behind: the hue, the motes, and the streams from one phone
 * to the other. Without WebGL the screens, captions and timelines still play.
 */
export function StoryPlayer({ stories, eager = false }: { stories: readonly Story[]; eager?: boolean }) {
  const flat = useMemo<Flat[]>(() => stories.flatMap((story, storyIndex) => story.steps.map((step) => ({ story, storyIndex, step }))), [stories]);
  /** One screen of scroll per story. */
  const n = stories.length;
  const runRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const phoneA = useRef<HTMLDivElement | null>(null);
  const phoneB = useRef<HTMLDivElement | null>(null);
  const featureEls = useRef<(HTMLElement | null)[]>([]);
  const pinEls = useRef<(HTMLElement | null)[]>([]);
  const highlightEl = useRef<HTMLElement | null>(null);
  const pathEls = useRef<(SVGPathElement | null)[]>([]);
  const livePath = useRef<SVGPathElement | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const chipEls = useRef<(HTMLButtonElement | null)[]>([]);
  const tabsRef = useRef<HTMLOListElement>(null);
  // The story the scroll is on, and the step of it that is playing.
  const [storyIndex, setStoryIndex] = useState(0);
  const activeRef = useRef(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [visible, setVisible] = useState(false);
  const [gl, setGl] = useState(false);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [hover, setHover] = useState(-1);
  const popRef = useRef(0);

  const story = stories[storyIndex];
  const step = story.steps[stepIndex] ?? story.steps[0];
  const active = flat.findIndex((f) => f.step === step);
  const nextStep = () => {
    setReplay(null);
    setStepIndex((i) => (i + 1) % story.steps.length);
    setRound((r) => r + 1);
  };
  const { screens, lit, touch, highlight, pop } = useTimeline(step, visible, replay, round, nextStep);
  if (pop) popRef.current = pop.key;
  // One feature is lit at a time: the one the mouse is over, else the playing one.
  const shown = hover >= 0 ? hover : lit;
  // The playing feature's ring (and its line) steps aside while another is previewed.
  const ring = shown === lit ? highlight : null;
  const litRef = useRef(-1);
  litRef.current = lit;

  useEffect(() => {
    const run = runRef.current;
    const stage = stageRef.current;
    const inner = innerRef.current;
    if (!run || !stage || !inner) return;
    let disposed = false;
    let scene: StreamsScene | null = null;
    let render: (() => void) | null = null;
    let teardownGl = () => {};
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hueOf = () => cssColorToHex(getComputedStyle(stage).getPropertyValue("--hue-glyph").trim() || "#ff7a59");
    const fgOf = () => cssColorToHex(getComputedStyle(stage).getPropertyValue("--foreground").trim() || "#ffffff");

    const start = async () => {
      const [THREE, { createStreamsScene }] = await Promise.all([import("three"), import("./scenes/streams")]);
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = styles.stageCanvas;
      stage.prepend(renderer.domElement);
      const three = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
      scene = createStreamsScene(THREE, three, camera);
      const resize = () => {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        if (w && h) {
          renderer.setSize(w, h, false);
          scene?.resize(w, h);
        }
      };
      const ro = new ResizeObserver(resize);
      ro.observe(stage);
      resize();
      render = () => renderer.render(three, camera);
      setGl(true);
      teardownGl = () => {
        ro.disconnect();
        scene?.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        scene = null;
        render = null;
      };
    };

    let near = false;
    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        near = entries[0]?.isIntersecting ?? false;
        setVisible(near);
        if (near && !started) {
          started = true;
          void start().catch(() => {});
        }
      },
      { rootMargin: "30% 0px" }
    );
    io.observe(run);

    const pointer: Pointer = { x: 0, y: 0 };
    const target: Pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = stage.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      target.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let eased = 0;
    let lastPop = 0;
    let burst = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!near) return;
      const rect = run.getBoundingClientRect();
      const p = clamp(-rect.top / Math.max(1, rect.height - stage.clientHeight), 0, 1);
      if (reduced.matches) eased = p;
      else {
        t += dt;
        eased = lerp(eased, p, 1 - Math.pow(0.002, dt));
      }
      pointer.x = lerp(pointer.x, target.x, 0.06);
      pointer.y = lerp(pointer.y, target.y, 0.06);

      const index = Math.min(n - 1, Math.floor(eased * n + 0.0001));
      if (index !== activeRef.current) {
        activeRef.current = index;
        setStoryIndex(index);
        setStepIndex(0);
        setReplay(null);
        setHover(-1);
      }

      // The lines from the features to their spots, measured every frame so
      // they follow the caption's fade and the phones' flip.
      const box: PxRect = { x: 0, y: 0, w: inner.clientWidth, h: inner.clientHeight };
      const listEdge = (li: HTMLElement) => {
        const list = li.closest("ol");
        if (!list) return undefined;
        const r = rectIn(list, inner);
        return r.x + r.w;
      };
      pathEls.current.forEach((path, i) => {
        const li = featureEls.current[i];
        const pin = pinEls.current[i];
        if (!path) return;
        if (li && pin) path.setAttribute("d", linePath(rectIn(li, inner), rectIn(pin, inner), box, listEdge(li)));
        else path.removeAttribute("d");
      });
      const live = livePath.current;
      if (live) {
        const li = litRef.current >= 0 ? featureEls.current[litRef.current] : null;
        const h = highlightEl.current;
        if (li && h) live.setAttribute("d", linePath(rectIn(li, inner), rectIn(h, inner), box, listEdge(li)));
        else live.removeAttribute("d");
      }

      if (scene && render) {
        if (popRef.current !== lastPop) {
          lastPop = popRef.current;
          burst = 1;
        }
        burst = Math.max(0, burst - dt * 0.9);
        const a = phoneA.current ? rectIn(phoneA.current, stage) : null;
        const b = phoneB.current ? rectIn(phoneB.current, stage) : null;
        scene.update({ t, p: eased, pointer, phone: a, card: b, cardSide: "right", hue: hueOf(), foreground: fgOf(), burst });
        render();
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      teardownGl();
    };
  }, [n]);

  const screensA = useMemo(() => screensFor(story, "a"), [story]);
  const screensB = useMemo(() => screensFor(story, "b"), [story]);
  const two = !!screens.b;
  const pins = useMemo<Pin[]>(
    () => step.features.flatMap((f, i) => (f.target ? [{ i, on: f.target.on, rect: spotRect(f.target), scene: Array.isArray(f.target.rect) ? undefined : (f.target.rect as Mark).scene }] : [])),
    [step]
  );

  const goToStory = (i: number) => {
    const run = runRef.current;
    const stage = stageRef.current;
    if (!run || !stage) return;
    const top = run.getBoundingClientRect().top + window.scrollY;
    const travel = run.offsetHeight - stage.clientHeight;
    window.scrollTo({ top: top + ((i + 0.5) / n) * travel, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const goToStep = (i: number) => {
    setReplay(null);
    setStepIndex(i);
    setRound((r) => r + 1);
  };

  // The rail keeps the story's chip in view, and the tabs (one sideways row on
  // a phone) the playing step's; each scrolls itself, never the page.
  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const center = (row: HTMLElement | null, item: HTMLElement | null | undefined) => {
      if (row && item) row.scrollTo({ left: item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2, behavior });
    };
    center(railRef.current, chipEls.current[storyIndex]);
    center(tabsRef.current, tabsRef.current?.children[stepIndex] as HTMLElement | undefined);
  }, [storyIndex, stepIndex]);

  // Stale refs from the last step must not draw lines.
  featureEls.current.length = 0;
  pinEls.current.length = 0;
  highlightEl.current = null;

  return (
    <div ref={runRef} className={styles.run} style={{ height: `${n * 100 + 60}svh` }}>
      {/* An anchor per story at its scroll offset, for the nav's module menu (goToStory's formula, in svh). */}
      {stories.map((st, i) => (
        <span key={st.id} id={storyAnchor(st)} className={styles.storyAnchor} style={{ top: `${((i + 0.5) / n) * (n * 100 - 40)}svh` }} />
      ))}
      <div ref={stageRef} className={cn(styles.stage, gl && styles.stageGl)} data-hue={sectionHue(story.room)} role="group" aria-label={story.label}>
        {/* A chip per module, the current one lit; a tap scrolls to it. Under it, the module's steps. */}
        <div className={styles.stageTop}>
          <div ref={railRef} className={styles.rail}>
            {stories.map((st, i) => (
              <button
                key={st.id}
                ref={(el) => {
                  chipEls.current[i] = el;
                }}
                type="button"
                className={cn(styles.chip, i === storyIndex && styles.chipOn)}
                data-hue={sectionHue(st.room)}
                aria-current={i === storyIndex ? "true" : undefined}
                onClick={() => goToStory(i)}
              >
                <SectionTile sectionId={st.room} small />
                {st.name}
              </button>
            ))}
          </div>
          {story.steps.length > 1 && (
            <ol ref={tabsRef} className={styles.stepTabs} aria-label={`${story.name} steps`}>
              {story.steps.map((s, i) => (
                <li key={i}>
                  <button type="button" className={cn(styles.stepTab, i === stepIndex && styles.stepTabOn)} aria-current={i === stepIndex ? "step" : undefined} onClick={() => goToStep(i)}>
                    {s.title}
                    {i === stepIndex && visible && (
                      <span key={`${round}-${replay?.key ?? 0}`} className={styles.stepBar} style={{ animationDuration: `${stepLength(s, replayFrom(s, replay))}ms` }} aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div ref={innerRef} className={styles.stageInner}>
          <div className={styles.captions}>
            {flat.map(({ story: st, step: s }, i) => (
              <div key={i} className={cn(styles.caption, i === active && styles.captionOn)} aria-hidden={i !== active}>
                {s.lead}
                {s.title && <h2 className={cn(styles.display, styles.captionTitle)}>{s.title}</h2>}
                <ol className={styles.features}>
                  {s.features.map((f, j) => {
                    const on = i === active;
                    const can = playable(f);
                    const id = `${st.id}-${i}-${j}`;
                    const body = (
                      <>
                        <span className={styles.featureIdx} aria-hidden="true">
                          {String(j + 1).padStart(2, "0")}
                        </span>
                        <span>
                          <b id={`${id}-name`}>{f.name}</b> <span id={`${id}-text`}>{f.text}</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={f.name}>
                        {can ? (
                          <button
                            type="button"
                            ref={(el) => {
                              if (on) featureEls.current[j] = el;
                            }}
                            className={cn(styles.feature, styles.featurePlay, on && shown === j && styles.featureOn)}
                            aria-pressed={on && lit === j}
                            aria-labelledby={`${id}-name`}
                            aria-describedby={`${id}-text`}
                            tabIndex={on ? 0 : -1}
                            onClick={() => setReplay({ step: s, feature: j, key: Date.now() })}
                            // Only a mouse or the keyboard previews a feature: a tap leaves no hover or focus behind to light a second one.
                            onPointerEnter={(e) => e.pointerType === "mouse" && setHover(j)}
                            onPointerLeave={() => setHover(-1)}
                            onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHover(j)}
                            onBlur={() => setHover(-1)}
                          >
                            {body}
                          </button>
                        ) : (
                          <span className={styles.feature}>{body}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {s.after}
              </div>
            ))}
          </div>

          {/* Keyed by story: a new story's phones flip in after the colour has moved. */}
          <div key={story.id} className={cn(styles.phones, two && styles.phonesTwo)}>
            <Phone
              slot="a"
              screens={screensA}
              shown={screens.a}
              pins={pins}
              shownFeature={shown}
              touch={touch}
              highlight={ring}
              pop={pop}
              eager={eager && storyIndex === 0}
              phoneRef={(el) => {
                phoneA.current = el;
              }}
              pinRef={(i, el) => {
                pinEls.current[i] = el;
              }}
              highlightRef={(el) => {
                highlightEl.current = el;
              }}
            />
            {two && (
              <Phone
                slot="b"
                screens={screensB}
                shown={screens.b}
                pins={pins}
                shownFeature={shown}
                touch={touch}
                highlight={ring}
                pop={pop}
                eager={false}
                phoneRef={(el) => {
                  phoneB.current = el;
                }}
                pinRef={(i, el) => {
                  pinEls.current[i] = el;
                }}
                highlightRef={(el) => {
                  highlightEl.current = el;
                }}
              />
            )}
          </div>

          {/* The lines from the features to the phone, drawn by the frame loop. */}
          <svg key={`${story.id}-${stepIndex}`} className={styles.lines} aria-hidden="true">
            {step.features.map((f, j) =>
              f.target ? (
                <path
                  key={j}
                  ref={(el) => {
                    pathEls.current[j] = el;
                  }}
                  className={cn(styles.line, j === shown && styles.lineOn)}
                />
              ) : null
            )}
            <path
              ref={(el) => {
                livePath.current = el;
              }}
              className={cn(styles.line, styles.lineOn, styles.lineLive)}
            />
          </svg>
        </div>

      </div>
    </div>
  );
}
