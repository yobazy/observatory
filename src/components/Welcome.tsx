import { useEffect, useState } from "react";

// The first launch's hello: a little telescope on a tripod sweeps the sky,
// hunting, while the app gets going, then settles on a star that lights up
// and says welcome. Plays once (remembered in localStorage); a click or any
// key skips it, and reduced motion skips it altogether.

const KEY = "observatory.welcomed";

/** Background stars as [x, y, radius, twinkle delay in s]. */
const STARS: [number, number, number, number][] = [
  [22, 30, 1.2, 0.2],
  [48, 64, 0.9, 1.1],
  [70, 18, 1.4, 0.6],
  [104, 40, 1, 1.6],
  [128, 14, 1.3, 0.9],
  [150, 44, 0.8, 0.3],
  [206, 24, 1.1, 1.3],
  [210, 78, 0.9, 0.5],
  [34, 102, 0.8, 1.8],
  [192, 112, 1, 0.1],
  [88, 70, 0.7, 1.4],
  [12, 70, 1, 0.8],
];

export type ScopeMode = "intro" | "scan" | "rest";

/** The telescope itself, also used on the startup gate: "intro" hunts and
 *  then finds its star, "scan" sweeps for as long as something is setting
 *  up, "rest" sits pointed at the star. */
export function Telescope({ mode, size = 220 }: { mode: ScopeMode; size?: number }) {
  return (
    <svg className={`scope scope-${mode}`} viewBox="0 0 220 170" width={size} height={(size * 170) / 220} aria-hidden="true">
      {STARS.map(([x, y, r, d], i) => (
        <circle key={i} className="scope-star" cx={x} cy={y} r={r} style={{ animationDelay: `${d}s` }} />
      ))}

      {/* The star it finds, where the tube comes to rest. */}
      <g className="scope-target">
        <circle className="scope-target-glow" cx="181" cy="53" r="12" />
        <path className="scope-target-star" d="M181 43 Q182.4 51.6 191 53 Q182.4 54.4 181 63 Q179.6 54.4 171 53 Q179.6 51.6 181 43Z" />
      </g>

      {/* Ground and tripod. */}
      <path className="scope-ground" d="M14 156 Q110 146 206 156" />
      <g className="scope-legs">
        <line x1="100" y1="106" x2="72" y2="152" />
        <line x1="100" y1="106" x2="128" y2="152" />
        <line x1="100" y1="106" x2="101" y2="155" />
      </g>

      {/* The tube, drawn pointing right and turned about the mount. */}
      <g className="scope-tube">
        <rect className="scope-eyepiece" x="60" y="100" width="13" height="8" rx="2" />
        <rect className="scope-body" x="71" y="95" width="66" height="18" rx="5" />
        <rect className="scope-band" x="88" y="95" width="5" height="18" />
        <rect className="scope-band" x="116" y="95" width="5" height="18" />
        <rect className="scope-finder" x="94" y="88" width="20" height="5" rx="2.5" />
        <rect className="scope-hood" x="134" y="92" width="16" height="24" rx="4" />
        <ellipse className="scope-glint" cx="150" cy="104" rx="2" ry="9" />
      </g>
      <circle className="scope-mount" cx="100" cy="104" r="6" />
    </svg>
  );
}

const LINES = ["Polishing the lens…", "Finding north…", "Looking for your agents…"];
const LINE_MS = 1100;
const FOUND_MS = 3300; // matches the tube's sweep in styles.css
const DONE_MS = 5200;

function shouldPlay(): boolean {
  try {
    if (localStorage.getItem(KEY)) return false;
    localStorage.setItem(KEY, "1");
  } catch {
    return false;
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Welcome() {
  const [show] = useState(shouldPlay);
  const [t, setT] = useState(0); // ms since start, in coarse steps
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(!show);

  useEffect(() => {
    if (!show) return;
    const timers = [
      ...LINES.map((_, i) => setTimeout(() => setT(i * LINE_MS), i * LINE_MS)),
      setTimeout(() => setT(FOUND_MS), FOUND_MS),
      setTimeout(() => setLeaving(true), DONE_MS),
    ];
    const skip = () => setLeaving(true);
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("keydown", skip);
    };
  }, [show]);

  if (gone) return null;
  const found = t >= FOUND_MS;

  return (
    <div
      className={`welcome${leaving ? " welcome-leaving" : ""}`}
      data-tauri-drag-region
      onClick={() => setLeaving(true)}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && leaving) setGone(true);
      }}
    >
      <Telescope mode="intro" size={260} />
      <div className="welcome-text" aria-live="polite">
        {found ? (
          <h1 key="hi" className="welcome-hi">
            Welcome to Observatory
          </h1>
        ) : (
          <p key={t} className="welcome-line">
            {LINES[Math.round(t / LINE_MS)]}
          </p>
        )}
      </div>
    </div>
  );
}
