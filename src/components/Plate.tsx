// A thread's (or project's) artwork: a patch of night sky whose stardust is
// moved by its work into a figure, the way sand finds a Chladni plate's still
// lines (plate.ts). Running plates keep shifting, a plate waiting on you holds
// and twinkles, and everything else settles and stops drawing. One animation
// loop serves every plate on screen.
import { useEffect, useRef } from "react";
import { STAR, sandFill, scatter, settle, starLight, workMode, type Mode } from "../nebula/plate";
import { getState, subscribe } from "../nebula/store";
import { useTurns } from "../nebula/turnCount";
import type { Agent, AgentStatus } from "../nebula/types";

export type PlateTone = AgentStatus | "sand";

/** A thread's tone, as its dot read: a finished turn you've already seen
 *  rests in grey, and only an unread one keeps its green. */
export function plateTone(agent: Agent): PlateTone {
  return agent.status === "finished" && !agent.unseen ? "fresh" : agent.status;
}

interface Props {
  /** Picks the figure; a thread's id, a project's path. */
  seed: string;
  /** How much it has done: each unit moves the sand to a new figure. */
  work: number;
  tone: PlateTone;
  size: number;
  /** Keeps shifting through figures, even between units of work: while it runs. */
  drift?: boolean;
  round?: boolean;
  /** Turns taken: the plate holds more sand the more it has done. Unset is full. */
  fill?: number;
  /** Sand that hasn't found its figure: what's behind it is still loading. */
  loose?: boolean;
  /** One of many on a sheet: settles once when it comes on screen, out of
   *  sight of the animation loop, and never moves again. */
  still?: boolean;
  className?: string;
  label?: string;
}

interface Live {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  grains: Float32Array;
  /** Each grain's brightness (starLight): mostly dust, a few stars. */
  light: Float32Array;
  from: Mode;
  to: Mode;
  k: number;
  tone: PlateTone;
  size: number;
  round: boolean;
  drift: boolean;
  seed: string;
  work: number;
  t: number;
  /** Frames left before a still plate stops drawing. */
  settling: number;
  /** An extra shake that dies away: the plate struck when its thread opens
   *  or finishes, so the sand jumps and settles again. */
  kick: number;
  /** Grains out on the plate, of those made. */
  count: number;
  loose: boolean;
  visible: boolean;
  /** Grain size, times the usual: an icon the Dock shrinks needs coarser sand. */
  dot?: number;
  /** Passes left before a still plate's figure is done. */
  developing?: number;
  /** Time since this plate last drew, for the ones that draw at a slower rate. */
  since?: number;
}

const DPR = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const plates = new Set<Live>();
let frame = 0;
let last = 0;
let palette: Record<string, string> | null = null;
/** A soft star in each tone, drawn once and stamped wherever a star sits. */
const glows = new Map<string, HTMLCanvasElement>();
/** When the daemon's first snapshot landed: plates that mount just after
 *  arrive as loose sand and settle, the list's loading going away. */
let landedAt = getState().loaded ? -1e9 : 0;

/** The colors live in CSS, so a mode or theme change recolors every plate. */
function colors() {
  if (!palette) {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    palette = {
      hi: v("--plate-hi"),
      lo: v("--plate-lo"),
      sand: v("--sand"),
      needs_feedback: v("--plate-waiting"),
      running: v("--plate-running"),
      finished: v("--plate-done"),
      terminated: v("--plate-error"),
      idle: v("--plate-idle"),
    };
  }
  return palette;
}
let lastMode = getState().mode;
subscribe(() => {
  if (getState().loaded && landedAt === 0) landedAt = performance.now();
  if (getState().mode === lastMode) return;
  lastMode = getState().mode;
  palette = null;
  glows.clear();
  // The new values land after this paint.
  requestAnimationFrame(() => {
    palette = null;
    glows.clear();
    for (const p of plates) draw(p);
  });
});

const isBig = (p: Live) => p.size > 48;
const moving = (p: Live) =>
  p.developing === undefined &&
  (p.drift || p.loose || p.tone === "running" || p.tone === "needs_feedback" || p.settling > 0 || p.k < 1 || p.kick > 0);

/** A plate with nothing left to settle: only a waiting one's twinkle moves it. */
const resting = (p: Live) => p.k >= 1 && p.settling <= 0 && p.kick === 0 && !p.drift && !p.loose;

/** Seconds between frames for a plate that doesn't need every one: a
 *  twinkle reads fine at 20 a second, and a small plate's few grains at 30. */
function frameGap(p: Live) {
  if (resting(p)) return p.tone === "needs_feedback" ? 1 / 20 : Infinity;
  return isBig(p) ? 0 : 1 / 30;
}

/** `#rrggbb` at an opacity, for the glow's falloff. */
function withAlpha(color: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function glow(color: string) {
  let g = glows.get(color);
  if (!g) {
    g = document.createElement("canvas");
    g.width = g.height = 64;
    const ctx = g.getContext("2d")!;
    const r = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    // A near-white core in the tone's color, fading out fast: a star, not a blob.
    r.addColorStop(0, "rgba(255, 252, 244, 1)");
    r.addColorStop(0.08, withAlpha(color, 0.95));
    r.addColorStop(0.25, withAlpha(color, 0.28));
    r.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, 64, 64);
    glows.set(color, g);
  }
  return g;
}

function grainsFor(size: number) {
  return size > 110 ? 20000 : size > 70 ? 9000 : size > 48 ? 4200 : 260;
}

function step(p: Live, dt: number) {
  p.t += dt;
  if (p.drift && p.k >= 1 && p.t > (isBig(p) ? 7 : 3.4)) {
    // Between tool calls a running plate keeps feeling its way to the next figure.
    p.t = 0;
    p.work += 1;
    retarget(p, workMode(p.seed, p.work));
  }
  if (p.k < 1) p.k = Math.min(1, p.k + dt / (isBig(p) ? 1.6 : 1.1));
  const big = isBig(p);
  const shake = (p.tone === "running" || p.drift ? 0.004 : 0.0012) + (big ? 0.016 : 0) + p.kick + (p.loose ? 0.05 : 0);
  settle(p.grains.subarray(0, p.count * 2), p.from, p.to, p.k, p.loose ? 0.02 : big ? 0.14 : 0.35, shake);
  if (p.k >= 1 && p.settling > 0) p.settling--;
  if (p.kick > 0) p.kick = p.kick < 0.002 ? 0 : p.kick * Math.pow(0.03, dt);
}

function retarget(p: Live, to: Mode) {
  if (p.to[0] === to[0] && p.to[1] === to[1]) return;
  p.from = p.k >= 1 ? p.to : p.from;
  p.to = to;
  p.k = 0;
  p.settling = 90;
}

function draw(p: Live) {
  const { ctx, canvas, grains } = p;
  const c = colors();
  const W = canvas.width;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, W);
  ctx.save();
  ctx.beginPath();
  if (p.round) ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, W, W, W * 0.17);
  ctx.clip();
  const g = ctx.createRadialGradient(W * 0.32, W * 0.2, 0, W * 0.5, W * 0.5, W * 0.8);
  g.addColorStop(0, c.hi);
  g.addColorStop(1, c.lo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, W);

  const big = isBig(p);
  const tone = p.tone === "sand" ? c.sand : (c[p.tone] ?? c.idle);
  const waiting = p.tone === "needs_feedback" && !reduced();
  const inset = W * (big ? (p.round ? 0.1 : 0.07) : 0.13);
  const span = W - inset * 2;
  const d = DPR * 0.42 * (p.dot ?? 1);
  const { light } = p;
  const n = p.count;
  ctx.fillStyle = tone;
  if (big) {
    // Dust piles light up where it gathers, a faint milky band along the
    // figure; the brightest grains are stars on top of it, and a waiting
    // plate's stars twinkle each in their own time.
    ctx.globalCompositeOperation = "lighter";
    const dust = d * 0.8;
    ctx.globalAlpha = (p.size > 110 ? 0.06 : 0.09) * (waiting ? 0.88 + 0.12 * Math.sin(p.t * 2.4) : 1);
    for (let i = 0; i < n; i++) {
      if (light[i] < STAR) ctx.fillRect(inset + grains[2 * i] * span - dust, inset + grains[2 * i + 1] * span - dust, dust * 2, dust * 2);
    }
    const sprite = glow(tone);
    const R = W * 0.034;
    for (let i = 0; i < n; i++) {
      const b = light[i];
      if (b < STAR) continue;
      const r = R * (0.55 + 0.9 * (b - STAR) * 2);
      ctx.globalAlpha = (0.6 + 0.4 * b) * (waiting ? 0.55 + 0.45 * Math.sin(p.t * 2.4 + i * 2.39) : 1);
      ctx.drawImage(sprite, inset + grains[2 * i] * span - r, inset + grains[2 * i + 1] * span - r, r * 2, r * 2);
    }
  } else {
    // A small plate keeps its status color true: most grains a little
    // dimmer, the few stars a little larger, so it reads as a cluster.
    const pulse = waiting ? 0.75 + 0.25 * Math.sin(p.t * 2.4) : 1;
    for (const [lo, hi, a, s] of SMALL_BANDS) {
      ctx.globalAlpha = a * pulse;
      const e = d * s;
      for (let i = 0; i < n; i++) {
        if (light[i] >= lo && light[i] < hi) ctx.fillRect(inset + grains[2 * i] * span - e, inset + grains[2 * i + 1] * span - e, e * 2, e * 2);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

/** A small plate's brightness bands: [from, to, opacity, grain size]. */
const SMALL_BANDS: readonly [number, number, number, number][] = [
  [0, 0.001, 0.72, 1],
  [0.001, STAR, 0.95, 1],
  [STAR, 2, 1, 1.5],
];

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let any = false;
  if (!document.hidden) {
    for (const p of plates) {
      if (!p.visible || !moving(p)) continue;
      any = true;
      // Plates that don't need every frame skip some, and a resting one
      // skips the physics too: only its twinkle is moving.
      p.since = (p.since ?? 0) + dt;
      const gap = frameGap(p);
      if (p.since < gap) continue;
      if (resting(p)) p.t += p.since;
      else step(p, Math.min(0.05, p.since));
      p.since = 0;
      draw(p);
    }
  }
  frame = any || document.hidden ? requestAnimationFrame(loop) : 0;
}

function wake() {
  if (frame || reduced()) return;
  last = performance.now();
  frame = requestAnimationFrame(loop);
}

/** Still plates on screen with their figure to come. */
const darkroom = new Set<Live>();
let developing = 0;

/** Works through the darkroom a few milliseconds a frame, so a long sheet of
 *  still plates fills in without holding the window up. */
function develop() {
  const until = performance.now() + 4;
  for (const p of darkroom) {
    if (!plates.has(p) || !p.visible) {
      darkroom.delete(p);
      continue;
    }
    while (p.developing! > 0 && performance.now() < until) {
      settle(p.grains, p.to, p.to, 1, 0.14, 0.016);
      p.developing!--;
    }
    if (p.developing! > 0) break;
    darkroom.delete(p);
    p.count = p.grains.length / 2;
    draw(p);
    if (performance.now() >= until) break;
  }
  developing = darkroom.size ? requestAnimationFrame(develop) : 0;
}

function sendToDarkroom(p: Live) {
  if (!p.developing) return;
  darkroom.add(p);
  if (!developing) developing = requestAnimationFrame(develop);
}

const watcher =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
        for (const e of entries) {
          for (const p of plates) {
            if (p.canvas !== e.target) continue;
            p.visible = e.isIntersecting;
            if (p.visible) sendToDarkroom(p);
          }
        }
        wake();
      });

const countFor = (size: number, fill: number | undefined) =>
  fill === undefined ? grainsFor(size) : Math.round(grainsFor(size) * sandFill(fill, size <= 48));

export function Plate({ seed, work, tone, size, drift = false, round = true, fill, loose = false, still = false, className, label }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    canvas.width = canvas.height = Math.round(size * DPR);
    const mode = workMode(seed, work);
    const p: Live = {
      canvas,
      ctx: canvas.getContext("2d")!,
      grains: scatter(grainsFor(size), seed),
      light: starLight(grainsFor(size), seed),
      from: mode,
      to: mode,
      k: 1,
      tone,
      size,
      round,
      drift,
      seed,
      work,
      t: (hashT(seed) % 997) / 997 * 3,
      settling: 0,
      kick: 0,
      count: still ? 0 : countFor(size, fill),
      loose,
      visible: true,
      developing: still ? 45 : undefined,
    };
    if (still) {
      // One of many: bare metal for now, its figure once it's on screen.
      draw(p);
      plates.add(p);
      live.current = p;
      if (watcher) watcher.observe(canvas);
      else sendToDarkroom(p);
      return () => {
        plates.delete(p);
        watcher?.unobserve(canvas);
        live.current = null;
      };
    }
    // Small plates arrive settled: their first frame is their figure. A big
    // one (a thread or project just opened) arrives half formed and settles
    // in front of you, and so does any plate that comes in with the first
    // load, out of the loose sand that stood in for it.
    const landing = !reduced() && performance.now() - landedAt < 1600;
    const struck = isBig(p) && !reduced();
    const pre = loose || landing ? 0 : struck ? 6 : isBig(p) ? 45 : 40;
    for (let i = 0; i < pre; i++) settle(p.grains, mode, mode, 1, isBig(p) ? 0.14 : 0.35, isBig(p) ? 0.016 : 0);
    if (landing && !loose) {
      p.kick = 0.02;
      p.settling = 110;
    } else if (struck) {
      p.kick = 0.02;
      p.settling = 80;
    }
    draw(p);
    plates.add(p);
    live.current = p;
    watcher?.observe(canvas);
    wake();
    return () => {
      plates.delete(p);
      watcher?.unobserve(canvas);
      live.current = null;
    };
    // A new seed or size is a new plate; the rest updates the live one below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, size, round]);

  useEffect(() => {
    const p = live.current;
    if (!p || still) return;
    // A thread that just finished gets one last shake before it rests,
    // read or not: one you're watching is marked seen as it finishes.
    if ((tone === "finished" || tone === "fresh") && (p.tone === "running" || p.tone === "needs_feedback") && !reduced()) {
      p.kick = isBig(p) ? 0.03 : 0.015;
      p.settling = Math.max(p.settling, 90);
    }
    p.tone = tone;
    p.drift = drift;
    if (p.loose && !loose) {
      // The data landed: the sand finds its figure.
      p.kick = reduced() ? 0 : 0.02;
      p.settling = Math.max(p.settling, 110);
    }
    p.loose = loose;
    const count = countFor(p.size, fill);
    if (count !== p.count) {
      // More turns put more sand out; it arrives loose and settles in.
      p.count = Math.min(count, p.grains.length / 2);
      p.settling = Math.max(p.settling, 90);
    }
    if (work !== p.work) {
      p.work = work;
      retarget(p, workMode(seed, work));
    }
    if (reduced()) {
      // No motion: jump straight to the new figure.
      p.from = p.to;
      p.k = 1;
      for (let i = 0; i < 40; i++) settle(p.grains, p.to, p.to, 1, isBig(p) ? 0.14 : 0.35, isBig(p) ? 0.016 : 0);
    }
    p.settling = Math.max(p.settling, 30);
    draw(p);
    wake();
  }, [seed, work, tone, drift, fill, loose]);

  return (
    <canvas
      ref={ref}
      className={`plate${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** A thread's plate: its figure moved by its prompts (or `work`, when the
 *  caller counts its steps too), its sand as deep as the turns it has taken. */
export function ThreadPlate({ agent, size, work, loose }: { agent: Agent; size: number; work?: number; loose?: boolean }) {
  const turns = useTurns(agent);
  return (
    <Plate
      seed={agent.id}
      work={work ?? agent.recent_prompts.length}
      tone={plateTone(agent)}
      size={size}
      drift={agent.status === "running"}
      fill={turns}
      loose={loose}
    />
  );
}

/** A per-plate phase, so waiting plates don't all pulse in step. */
function hashT(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A plate drawn once, settled, as a square app icon with macOS's margin
 *  around it: the Dock's picture of the thread that needs you most. */
export function plateIcon(seed: string, work: number, tone: PlateTone, px = 512): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = out.height = px;
  const art = document.createElement("canvas");
  // Apple's icon grid: the shape is 824 of 1024, centered.
  const inner = Math.round(px * 0.805);
  art.width = art.height = inner;
  const mode = workMode(seed, work);
  const size = inner / DPR;
  const p: Live = {
    canvas: art,
    ctx: art.getContext("2d")!,
    grains: scatter(9000, seed),
    light: starLight(9000, seed),
    from: mode,
    to: mode,
    k: 1,
    tone,
    size,
    round: false,
    drift: false,
    seed,
    work,
    t: 0,
    settling: 0,
    kick: 0,
    count: 9000,
    loose: false,
    visible: false,
    dot: 3.2,
  };
  for (let i = 0; i < 45; i++) settle(p.grains, mode, mode, 1, 0.14, 0.016);
  draw(p);
  const ctx = out.getContext("2d")!;
  const at = (px - inner) / 2;
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = px * 0.02;
  ctx.shadowOffsetY = px * 0.01;
  ctx.drawImage(art, at, at);
  return out;
}
