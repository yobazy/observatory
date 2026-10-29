#!/usr/bin/env node
// Retakes the README's pictures, and the cover every release page leads with,
// from the browser preview's demo data (never real sessions):
//
//   node scripts/screenshots.mjs          stills and the demo GIF
//   node scripts/screenshots.mjs stills   just the stills
//
// It builds the app, serves it on a spare port and drives it with Playwright
// at 1440×860 in dark mode. Stills are 2× JPEGs (sips, quality 60); the GIF is
// a recording with a drawn cursor, cut down by ffmpeg to 880px at 8 fps.
// Run it before every release, so the README shows the app as it ships.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

// A drawn cursor, since recordings don't show the real one.
const CURSOR = `
  const c = document.createElement("div");
  c.id = "demo-cursor";
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "720px", top: "430px", zIndex: 2147483647,
    pointerEvents: "none", transition: "left .45s ease, top .45s ease" });
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(c));
`;

async function demo() {
  const context = await browser.newContext({
    viewport: VIEW,
    colorScheme: "dark",
    recordVideo: { dir: tmp, size: VIEW },
  });
  await context.addInitScript(CURSOR);
  const recording = Date.now();
  const page = await context.newPage();
  await page.goto(URL_);
  await page.waitForTimeout(9000);
  const start = Date.now();

  const pause = (ms) => page.waitForTimeout(ms);
  async function point(locator) {
    const box = await locator.boundingBox();
    const x = box.x + Math.min(box.width / 2, 60);
    const y = box.y + box.height / 2;
    await page.evaluate(([x, y]) => {
      const c = document.getElementById("demo-cursor");
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    }, [x, y]);
    await page.mouse.move(x, y, { steps: 8 });
    await pause(550);
  }
  async function click(locator, wait = 1400) {
    await point(locator);
    await locator.click();
    await pause(wait);
  }

  // A thread that's waiting on you, read as a conversation.
  await click(page.locator("button").filter({ hasText: /Hero Section Redesign/ }).first(), 1800);
  await click(button(page, "Read"), 1500);
  await page.mouse.wheel(0, 700);
  await pause(1800);
  // Jumping between threads from the Live strip.
  await click(page.getByText("Sequentia", { exact: false }).first(), 2000);
  await click(button(page, "Terminal"), 1800);
  // Another project.
  await click(page.locator("button").filter({ hasText: /admin-dashboard/ }).first(), 1800);
  await click(page.locator("button").filter({ hasText: /storefront/ }).first(), 1500);
  // Agent usage.
  await click(page.locator("button").filter({ hasText: /Usage/ }).first(), 2600);
  await page.keyboard.press("Meta+u");
  await pause(800);
  // Color themes.
  await page.keyboard.press("Meta+,");
  await pause(1200);
  for (const accent of ["Ocean", "Rose", "Amber", "Default"]) {
    await click(button(page, accent), 1000);
  }
  await click(button(page, "Light"), 1400);
  await click(button(page, "Dark"), 1200);
  await page.keyboard.press("Meta+,");
  await pause(1500);

  // Cut the splash: the GIF starts on the settled window.
  const lead = (start - recording) / 1000;
  const video = await page.video().path();
  await context.close();
  const palette = join(tmp, "palette.png");
  const filters = "fps=8,scale=880:-1:flags=lanczos";
  run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(lead), "-i", video, "-vf",
    `${filters},palettegen=max_colors=96`, palette]);
  run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(lead), "-i", video, "-i", palette,
    "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=none`, join(root, "docs/demo.gif")]);
  console.log("  docs/demo.gif");
}

try {
  await stills();
  if (only !== "stills") await demo();
} finally {
  await browser.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
