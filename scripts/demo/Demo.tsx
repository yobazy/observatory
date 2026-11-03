// The README demo: a Playwright recording of the browser preview's demo data,
// with a camera that eases toward what's being clicked, a drawn cursor and
// captions. scripts/screenshots.mjs records the flow and logs where the
// cursor went, what the camera should look at and when each caption starts;
// this turns that log into the video. Times are seconds from the recording's
// start, points are page pixels on the 1440×860 window.
import "@fontsource-variable/bricolage-grotesque";
import {
  AbsoluteFill,
  Composition,
  Easing,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type Point = { t: number; x: number; y: number };
export type Shot = Point & { zoom: number };
export type Caption = { t: number; text: string };
export type DemoProps = {
  seconds: number;
  cursor: Point[];
  clicks: number[];
  camera: Shot[];
  captions: Caption[];
};

const W = 1440;
const H = 860;
const FPS = 30;
// The window sits inset on a backdrop, like a screenshot of a Mac window.
const INSET = 0.9;
const MX = (W * (1 - INSET)) / 2;
const MY = (H * (1 - INSET)) / 2;
const MOVE = 1; // seconds the camera takes to reach a new shot
const GLIDE = 0.5; // seconds the cursor takes to reach a new point
const FADE = 0.35;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

const stage = (x: number, y: number) => ({ x: MX + x * INSET, y: MY + y * INSET });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type View = { zoom: number; x: number; y: number };

function mix(a: View, b: View, p: number): View {
  return {
    // Zoom eases in log space, so 1→2 feels as even as 2→1.
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * p),
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
  };
}

// Each shot starts easing from wherever the camera was when it was called,
// so a shot that comes before the last one finished still moves smoothly.
function cameraAt(t: number, shots: Shot[]): View {
  let view: View = { zoom: 1, x: W / 2, y: H / 2 };
  for (let i = 0; i < shots.length && shots[i].t <= t; i++) {
    const shot = shots[i];
    const until = i + 1 < shots.length ? Math.min(t, shots[i + 1].t) : t;
    const p = ease(Math.min(1, (until - shot.t) / MOVE));
    view = mix(view, { zoom: shot.zoom, ...stage(shot.x, shot.y) }, p);
  }
  // Never show past the backdrop's edge.
  const halfW = W / (2 * view.zoom);
  const halfH = H / (2 * view.zoom);
  return { zoom: view.zoom, x: clamp(view.x, halfW, W - halfW), y: clamp(view.y, halfH, H - halfH) };
}

function cursorAt(t: number, points: Point[]) {
  let at = { x: W / 2, y: H / 2 };
  for (let i = 0; i < points.length && points[i].t <= t; i++) {
    const p = ease(Math.min(1, (t - points[i].t) / GLIDE));
    at = { x: at.x + (points[i].x - at.x) * p, y: at.y + (points[i].y - at.y) * p };
  }
  return stage(at.x, at.y);
}

function Cursor({ t, cursor, clicks }: { t: number; cursor: Point[]; clicks: number[] }) {
  const { x, y } = cursorAt(t, cursor);
  const since = clicks.filter((c) => c <= t).map((c) => t - c);
  const last = since.length ? since[since.length - 1] : Infinity;
  const press = last < 0.18 ? 0.88 : 1;
  return (
    <>
      {last < 0.6 && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: 0,
            height: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -(8 + last * 50),
              top: -(8 + last * 50),
              width: 2 * (8 + last * 50),
              height: 2 * (8 + last * 50),
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.9)",
              opacity: 0.7 * (1 - last / 0.6),
            }}
          />
        </div>
      )}
      <svg
        width={22}
        height={22}
        viewBox="0 0 22 22"
        style={{
          position: "absolute",
          left: x - 3,
          top: y - 2,
          transform: `scale(${press})`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))",
        }}
      >
        <path
          d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z"
          fill="#fff"
          stroke="#111"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
}

function Captions({ t, captions, seconds }: { t: number; captions: Caption[]; seconds: number }) {
  const i = captions.findLastIndex((c) => c.t <= t);
  if (i < 0) return null;
  const end = i + 1 < captions.length ? captions[i + 1].t : seconds;
  const opacity = Math.min(1, (t - captions[i].t) / FADE, (end - t) / FADE);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 38,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${(1 - opacity) * 8}px)`,
      }}
    >
      <div
        style={{
          fontFamily: "'Bricolage Grotesque Variable', sans-serif",
          fontSize: 25,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "#f4f1ea",
          background: "rgba(14, 16, 26, 0.86)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          padding: "11px 24px",
          borderRadius: 999,
        }}
      >
        {captions[i].text}
      </div>
    </div>
  );
}

export function Demo({ seconds, cursor, clicks, camera, captions }: DemoProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const view = cameraAt(t, camera);
  return (
    <AbsoluteFill
      style={{ background: "radial-gradient(120% 100% at 50% 0%, #20264a 0%, #0c0e1a 62%, #07080f 100%)" }}
    >
      <AbsoluteFill
        style={{
          transformOrigin: "0 0",
          transform: `translate(${W / 2 - view.zoom * view.x}px, ${H / 2 - view.zoom * view.y}px) scale(${view.zoom})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: MX,
            top: MY,
            width: W * INSET,
            height: H * INSET,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          }}
        >
          <OffthreadVideo src={staticFile("recording.mp4")} muted style={{ width: "100%", height: "100%" }} />
        </div>
        <Cursor t={t} cursor={cursor} clicks={clicks} />
      </AbsoluteFill>
      <Captions t={t} captions={captions} seconds={seconds} />
    </AbsoluteFill>
  );
}

export function Root() {
  return (
    <Composition
      id="Demo"
      component={Demo}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{ seconds: 1, cursor: [], clicks: [], camera: [], captions: [] } as DemoProps}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil(props.seconds * FPS) })}
    />
  );
}
