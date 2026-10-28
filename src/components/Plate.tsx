// A thread's (or project's) artwork: a Chladni plate whose sand is moved by
// its work (plate.ts). Running plates keep shifting, a plate waiting on you
// holds and pulses, and everything else settles and stops drawing. One
// animation loop serves every plate on screen.
import { useEffect, useRef } from "react";
import { scatter, settle, workMode, type Mode } from "../nebula/plate";
import { getState, subscribe } from "../nebula/store";
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
  className?: string;
  label?: string;
}

interface Live {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  grains: Float32Array;
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
  visible: boolean;
}

const DPR = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const plates = new Set<Live>();
let frame = 0;
let last = 0;
let palette: Record<string, string> | null = null;

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
  if (getState().mode === lastMode) return;
  lastMode = getState().mode;
  palette = null;
  // The new values land after this paint.
  requestAnimationFrame(() => {
    palette = null;
    for (const p of plates) draw(p);
  });
});

const isBig = (p: Live) => p.size > 48;
const moving = (p: Live) => p.drift || p.tone === "running" || p.tone === "needs_feedback" || p.settling > 0 || p.k < 1;

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
  const shake = (p.tone === "running" || p.drift ? 0.004 : 0.0012) + (big ? 0.016 : 0);
  settle(p.grains, p.from, p.to, p.k, big ? 0.14 : 0.35, shake);
  if (p.k >= 1 && p.settling > 0) p.settling--;
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
  const pulse = p.tone === "needs_feedback" && !reduced() ? 0.75 + 0.25 * Math.sin(p.t * 2.4) : 1;
  // Big plates pile light up where the sand gathers; small ones keep their
  // status color true instead of washing out to white.
  ctx.globalCompositeOperation = big ? "lighter" : "source-over";
  ctx.fillStyle = tone;
  ctx.globalAlpha = (big ? (p.size > 110 ? 0.15 : 0.22) : 0.9) * pulse;
  const inset = W * (big ? (p.round ? 0.1 : 0.07) : 0.13);
  const span = W - inset * 2;
  const d = DPR * 0.42;
  for (let i = 0; i < grains.length; i += 2) ctx.fillRect(inset + grains[i] * span - d, inset + grains[i + 1] * span - d, d * 2, d * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  if (big) {
    // The post the plate is mounted on, and a soft sheen across the metal.
    const r = W * 0.026;
    const post = ctx.createRadialGradient(W / 2 - r / 4, W / 2 - r / 4, 0, W / 2, W / 2, r);
    post.addColorStop(0, "#6a665e");
    post.addColorStop(0.6, "#2a2825");
    post.addColorStop(1, "rgba(0,0,0,.6)");
    ctx.fillStyle = post;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, r, 0, Math.PI * 2);
    ctx.fill();
    const sheen = ctx.createLinearGradient(0, 0, W, W);
    sheen.addColorStop(0, "rgba(255,255,255,.07)");
    sheen.addColorStop(0.45, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, W);
  }
  ctx.restore();
}

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let any = false;
  if (!document.hidden) {
    for (const p of plates) {
      if (!p.visible || !moving(p)) continue;
      any = true;
      step(p, dt);
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

const watcher =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
        for (const e of entries) {
          for (const p of plates) if (p.canvas === e.target) p.visible = e.isIntersecting;
        }
        wake();
      });

export function Plate({ seed, work, tone, size, drift = false, round = true, className, label }: Props) {
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
      visible: true,
    };
    // Arrive already settled: a plate's first frame is its figure, not noise.
    for (let i = 0; i < (isBig(p) ? 45 : 40); i++) settle(p.grains, mode, mode, 1, isBig(p) ? 0.14 : 0.35, isBig(p) ? 0.016 : 0);
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
    if (!p) return;
    p.tone = tone;
    p.drift = drift;
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
  }, [seed, work, tone, drift]);

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

/** A per-plate phase, so waiting plates don't all pulse in step. */
function hashT(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
