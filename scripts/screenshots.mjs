#!/usr/bin/env node
// Retakes the README's pictures, and the cover every release page leads with,
// from the browser preview's demo data (never real sessions):
//
//   node scripts/screenshots.mjs          stills and the demo video and GIF
//   node scripts/screenshots.mjs stills   just the stills
//   node scripts/screenshots.mjs demo     just the demo
//
// It builds the app, serves it on a spare port and drives it with Playwright
// at 1440×860 in dark mode. Stills are 2× JPEGs (sips, quality 60). The demo
// is a video (docs/demo.mp4, see demo() below) and a GIF cut from it.
// Run it before every release, so the README shows the app as it ships.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const only = process.argv[2];
const PORT = 4318;
const URL_ = `http://localhost:${PORT}/`;
const VIEW = { width: 1440, height: 860 };
const tmp = mkdtempSync(join(tmpdir(), "observatory-shots-"));

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

run("npx", ["vite", "build"]);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
});
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();

// The telescope splash, then the sand plates settling.
async function open(options = {}) {
  const context = await browser.newContext({
    viewport: VIEW,
    colorScheme: "dark",
    deviceScaleFactor: 2,
    ...options,
  });
  const page = await context.newPage();
  await page.goto(URL_);
  await page.waitForTimeout(10000);
  return { context, page };
}

// A button or radio by its exact label.
const button = (page, label) =>
  page.locator("button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();

async function still(page, name, dir = "docs/screenshots") {
  const png = join(tmp, `${name}.png`);
  // No focus ring left on whatever the last key or click landed on.
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: png });
  const out = join(root, dir, `${name}.jpg`);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "60", png, "--out", out], {
    stdio: "ignore",
  });
  console.log(`  ${dir}/${name}.jpg`);
}

async function stills() {
  const { context, page } = await open();
  await still(page, "sessions");
  await still(page, "cover", "docs/release");

  await button(page, "Read").click();
  await page.waitForTimeout(1500);
  // The reply's end: its Needs you box and verdict.
  await page.getByText("Needs you", { exact: true }).last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await still(page, "read");
  await button(page, "Terminal").click();

  await page.keyboard.press("Meta+u");
  await page.waitForTimeout(2000);
  await still(page, "usage");
  await context.close();

  // Settings in Light with the Forest accent, to show the themes.
  const light = await open({ colorScheme: "light" });
  await light.page.keyboard.press("Meta+,");
  await light.page.waitForTimeout(800);
  await button(light.page, "Light").click();
  await button(light.page, "Forest").click();
  await light.page.waitForTimeout(1200);
  await still(light.page, "settings");
  await light.context.close();
}

// The demo: Chrome's screencast records the flow at 2×, sharp enough to zoom
// into, while the script logs where the cursor goes, what the camera should
// look at and when each caption starts. scripts/demo/Demo.tsx (Remotion)
// turns the recording and that log into the video: the window on a backdrop,
// a camera that eases toward what's clicked, a drawn cursor and captions.
async function demo() {
  const context = await browser.newContext({ viewport: VIEW, colorScheme: "dark", deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(URL_);
  await page.waitForTimeout(9000);

  const frames = join(tmp, "frames");
  mkdirSync(frames);
  const shots = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(frames, `${shots.length}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push({ t: metadata.timestamp, file });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 2880, maxHeight: 1720 });
  await page.waitForTimeout(300);
  const start = Date.now() / 1000;
  const now = () => Date.now() / 1000 - start;

  const cursor = [];
  const clicks = [];
  const camera = [];
  const captions = [];
  const pause = (ms) => page.waitForTimeout(ms);
  const say = (text) => captions.push({ t: now(), text });
  const look = (zoom, x = VIEW.width / 2, y = VIEW.height / 2) => camera.push({ t: now(), zoom, x, y });

  // Moves the real pointer too, so hover states show as the drawn one arrives.
  // With a zoom, the camera follows the cursor there.
  async function point(locator, zoom) {
    const box = await locator.boundingBox();
    const x = box.x + Math.min(box.width / 2, 60);
    const y = box.y + box.height / 2;
    cursor.push({ t: now(), x, y });
    if (zoom) look(zoom, x, y);
    await page.mouse.move(x, y, { steps: 12 });
    await pause(550);
    return { x, y };
  }
  async function click(locator, { wait = 1400, zoom } = {}) {
    const { x, y } = await point(locator, zoom);
    clicks.push(now());
    await page.mouse.click(x, y);
    await pause(wait);
  }

  say("Every agent you're running, in one window");
  await pause(2200);

  // A thread that's waiting on you, read as a conversation.
  say("Open the thread that's waiting on you");
  await click(page.locator("button").filter({ hasText: /Hero Section Redesign/ }).first(), { zoom: 1.7, wait: 1600 });
  say("Read it as a conversation, and answer from there");
  await click(button(page, "Read"), { zoom: 1.5, wait: 900 });
  look(1.35, 1080, 520);
  await pause(1000);
  await page.mouse.wheel(0, 700);
  await pause(2200);

  // Jumping between threads from the Live strip.
  say("Jump between threads from the Live strip");
  await click(page.getByText("Sequentia", { exact: false }).first(), { zoom: 1.6, wait: 1800 });
  await click(button(page, "Terminal"), { zoom: 1.4, wait: 1600 });

  // Another project.
  say("Every project, side by side");
  look(1.15, 400, 520);
  await click(page.locator("button").filter({ hasText: /admin-dashboard/ }).first(), { wait: 1600 });
  await click(page.locator("button").filter({ hasText: /storefront/ }).first(), { wait: 1300 });

  // Agent usage.
  say("What your agents cost, today and over time");
  await click(page.locator("button").filter({ hasText: /Usage/ }).first(), { zoom: 1, wait: 2800 });
  await page.keyboard.press("Meta+u");
  await pause(800);

  // Color themes.
  say("Light or dark, in the accent you like");
  await page.keyboard.press("Meta+,");
  await pause(1200);
  for (const accent of ["Ocean", "Rose", "Amber", "Default"]) {
    await click(button(page, accent), { zoom: 1.25, wait: 1000 });
  }
  await click(button(page, "Light"), { zoom: 1.25, wait: 1400 });
  await click(button(page, "Dark"), { zoom: 1.25, wait: 1200 });
  look(1);
  await page.keyboard.press("Meta+,");
  await pause(1800);
  const seconds = now();
  await cdp.send("Page.stopScreencast");
  await context.close();

  // The screencast only sends a frame when something changed: hold each one
  // until the next, starting from the frame on screen when the log started.
  const first = Math.max(0, shots.findLastIndex((s) => s.t <= start));
  const list = shots.slice(first).map((s, i, all) => {
    const from = Math.max(s.t, start);
    const to = i + 1 < all.length ? Math.max(all[i + 1].t, start) : start + seconds;
    return `file '${s.file}'\nduration ${Math.max(0, to - from).toFixed(4)}`;
  });
  const concat = join(tmp, "frames.txt");
  writeFileSync(concat, `${list.join("\n")}\nfile '${shots.at(-1).file}'\n`);
  const publicDir = join(tmp, "public");
  mkdirSync(publicDir);
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat, "-vf", "fps=30",
    "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", join(publicDir, "recording.mp4")]);

  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const inputProps = { seconds, cursor, clicks, camera, captions };
  const serveUrl = await bundle({ entryPoint: join(root, "scripts/demo/index.ts"), publicDir });
  const composition = await selectComposition({ serveUrl, id: "Demo", inputProps });
  const mp4 = join(root, "docs/demo.mp4");
  await renderMedia({ composition, serveUrl, inputProps, codec: "h264", crf: 26, scale: 1.5, outputLocation: mp4 });
  console.log("  docs/demo.mp4");

  // The README's GIF, cut down from the video. The camera moves every pixel,
  // which GIF compresses badly, so it stays at 8 fps to land under 10 MB.
  const palette = join(tmp, "palette.png");
  const filters = "fps=8,scale=800:-1:flags=lanczos";
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf",
    `${filters},palettegen=max_colors=96:stats_mode=diff`, palette]);
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-i", palette,
    "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, join(root, "docs/demo.gif")]);
  console.log("  docs/demo.gif");
}

try {
  if (only !== "demo") await stills();
  if (only !== "stills") await demo();
} finally {
  await browser.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
