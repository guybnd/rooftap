// The light behind a story stage: a glow in the room's hue, warmed toward
// Ember coral so no section reads muddy, and streams of light that flow from the phone to the card beside it when
// a step shows one. Drawn in CSS pixels with an orthographic camera, so the
// page measures the phone and the card in the DOM and the light lands on them.
import type * as ThreeModule from "three";
import { clamp, lerp, type Three } from "./shared";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StreamsState {
  /** Seconds; frozen under reduced motion. */
  t: number;
  /** Scroll progress through the stage, 0-1. */
  p: number;
  pointer: { x: number; y: number };
  phone: Rect | null;
  card: Rect | null;
  /** Which side of the phone the card sits on. */
  cardSide: "left" | "right";
  /** The room's hue as a hex colour. */
  hue: string;
  /** The page's foreground colour as hex. */
  foreground: string;
  /** 1 right after a pop on the second phone, fading to 0: the streams flare. */
  burst: number;
}

export interface StreamsScene {
  update(state: StreamsState): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

const STREAMS = 3;
const PER_STREAM = 70;

function glowTexture(THREE: Three, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function doteTexture(THREE: Three, size = 32) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStreamsScene(THREE: Three, scene: ThreeModule.Scene, camera: ThreeModule.OrthographicCamera): StreamsScene {
  const glow = glowTexture(THREE);
  const dot = doteTexture(THREE);
  let width = 1;
  let height = 1;
  // The hue moves towards the room's colour instead of switching, so a new
  // story's light arrives before its phones do.
  const hue = new THREE.Color("#ff7a59");
  const targetHue = new THREE.Color("#ff7a59");
  const ember = new THREE.Color("#ff7a59");
  const fg = new THREE.Color("#ffffff");

  // Two soft glows: one behind the phone, one that follows the card.
  const glowMat = new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.22 });
  const phoneGlow = new THREE.Sprite(glowMat);
  const cardGlowMat = glowMat.clone();
  cardGlowMat.opacity = 0;
  const cardGlow = new THREE.Sprite(cardGlowMat);
  scene.add(phoneGlow, cardGlow);


  // Streams: particles riding bezier curves from the phone's edge to the card.
  const streamGeo = new THREE.BufferGeometry();
  const streamPos = new Float32Array(STREAMS * PER_STREAM * 3);
  const streamCol = new Float32Array(STREAMS * PER_STREAM * 3);
  streamGeo.setAttribute("position", new THREE.BufferAttribute(streamPos, 3));
  streamGeo.setAttribute("color", new THREE.BufferAttribute(streamCol, 3));
  const streamMat = new THREE.PointsMaterial({ map: dot, size: 5, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false });
  const streams = new THREE.Points(streamGeo, streamMat);
  scene.add(streams);

  // The trails under the particles: faint lines along the same curves.
  const trailGeo = new THREE.BufferGeometry();
  const TRAIL_N = 48;
  const trailPos = new Float32Array(STREAMS * TRAIL_N * 3);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trailIndex: number[] = [];
  for (let s = 0; s < STREAMS; s++) for (let i = 0; i < TRAIL_N - 1; i++) trailIndex.push(s * TRAIL_N + i, s * TRAIL_N + i + 1);
  trailGeo.setIndex(trailIndex);
  const trailMat = new THREE.LineBasicMaterial({ color: hue, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const trails = new THREE.LineSegments(trailGeo, trailMat);
  scene.add(trails);

  const curves = Array.from({ length: STREAMS }, () => new THREE.CubicBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()));
  const v = new THREE.Vector3();
  let strength = 0;
  let last: StreamsState | null = null;
  let glowX = 0;
  let glowY = 0;
  let cardX = 0;
  let cardY = 0;

  // The camera maps CSS pixels: x right, y down.
  const place = (x: number, y: number) => v.set(x, -y, 0);

  function layoutCurves(state: StreamsState) {
    const { phone, card } = state;
    if (!phone || !card) return;
    const right = state.cardSide === "right";
    const fromX = right ? phone.x + phone.w - 14 : phone.x + 14;
    const toX = right ? card.x + 14 : card.x + card.w - 14;
    const dir = right ? 1 : -1;
    const dx = Math.abs(toX - fromX);
    for (let s = 0; s < STREAMS; s++) {
      const k = (s - (STREAMS - 1) / 2) / Math.max(1, STREAMS - 1);
      const fromY = phone.y + phone.h * (0.45 + k * 0.3);
      const toY = card.y + card.h * (0.45 + k * 0.3);
      const c = curves[s];
      c.v0.set(fromX, -fromY, 0);
      c.v1.set(fromX + dir * dx * 0.45, -fromY + Math.sin(state.t * 0.6 + s) * 18, 0);
      c.v2.set(toX - dir * dx * 0.4, -toY + Math.cos(state.t * 0.5 + s * 2) * 18, 0);
      c.v3.set(toX, -toY, 0);
    }
  }

  function update(state: StreamsState) {
    last = state;
    targetHue.set(state.hue).lerp(ember, 0.35);
    hue.lerp(targetHue, 0.045);
    fg.set(state.foreground);
    const { t, pointer, phone, card } = state;
    const want = phone && card ? 0.45 + 0.55 * clamp(state.burst, 0, 1) : 0;
    strength = lerp(strength, want, 0.08);

    // Glows.
    const px = phone ? phone.x + phone.w / 2 : width / 2;
    const py = phone ? phone.y + phone.h / 2 : height / 2;
    const breathe = 1 + 0.06 * Math.sin(t * 0.7);
    glowX = lerp(glowX, px + pointer.x * 30 + Math.sin(t * 0.3) * 24, 0.08);
    glowY = lerp(glowY, py + pointer.y * 20 + Math.cos(t * 0.23) * 20, 0.08);
    phoneGlow.position.copy(place(glowX, glowY));
    const size = Math.max(width, height) * 0.95 * breathe;
    phoneGlow.scale.set(size, size, 1);
    glowMat.color.copy(hue);
    cardGlowMat.color.copy(hue);
    if (card) {
      cardX = lerp(cardX || card.x + card.w / 2, card.x + card.w / 2, 0.1);
      cardY = lerp(cardY || card.y + card.h / 2, card.y + card.h / 2, 0.1);
    }
    cardGlow.position.copy(place(cardX, cardY));
    const cs = Math.max(card?.w ?? 0, card?.h ?? 0) * 2.4 + 80;
    cardGlow.scale.set(cs, cs, 1);
    cardGlowMat.opacity = 0.26 * strength;


    // Streams.
    streamMat.opacity = 0.95 * strength;
    trailMat.opacity = 0.22 * strength;
    trailMat.color.copy(hue);
    if (strength > 0.01 && phone && card) {
      layoutCurves(state);
      const sp = streamGeo.getAttribute("position") as ThreeModule.BufferAttribute;
      const sc = streamGeo.getAttribute("color") as ThreeModule.BufferAttribute;
      const spa = sp.array as Float32Array;
      const sca = sc.array as Float32Array;
      const tp = trailGeo.getAttribute("position") as ThreeModule.BufferAttribute;
      const tpa = tp.array as Float32Array;
      for (let s = 0; s < STREAMS; s++) {
        const c = curves[s];
        for (let i = 0; i < PER_STREAM; i++) {
          const n = s * PER_STREAM + i;
          const u = (i / PER_STREAM + t * (0.22 + s * 0.05)) % 1;
          c.getPoint(u, v);
          // Fan the particles a little off the curve.
          const wob = Math.sin(u * 14 + t * 2 + i) * 4;
          spa[n * 3] = v.x;
          spa[n * 3 + 1] = v.y + wob;
          spa[n * 3 + 2] = 0;
          // Bright at the start of the journey, warm by the end.
          const fade = Math.sin(u * Math.PI);
          const col = fg.clone().lerp(hue, clamp(u * 1.4, 0, 1)).multiplyScalar(0.25 + 0.75 * fade);
          sca[n * 3] = col.r;
          sca[n * 3 + 1] = col.g;
          sca[n * 3 + 2] = col.b;
        }
        for (let i = 0; i < TRAIL_N; i++) {
          c.getPoint(i / (TRAIL_N - 1), v);
          const n = s * TRAIL_N + i;
          tpa[n * 3] = v.x;
          tpa[n * 3 + 1] = v.y;
          tpa[n * 3 + 2] = 0;
        }
      }
      sp.needsUpdate = true;
      sc.needsUpdate = true;
      tp.needsUpdate = true;
    }
  }

  function resize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    if (last) update(last);
  }

  function dispose() {
    glow.dispose();
    dot.dispose();
    [glowMat, cardGlowMat, streamMat, trailMat].forEach((m) => m.dispose());
    [streamGeo, trailGeo].forEach((g) => g.dispose());
  }

  return { update, resize, dispose };
}
