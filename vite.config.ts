import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { cpSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

/** What pdf.js fetches at run time (nebula/pdf.ts). `vite dev` serves these
 *  from node_modules; a build needs its own copy. */
function pdfjsAssets() {
  return {
    name: "pdfjs-assets",
    apply: "build" as const,
    closeBundle() {
      for (const dir of ["wasm", "standard_fonts", "cmaps", "iccs"]) {
        cpSync(`node_modules/pdfjs-dist/${dir}`, `dist/pdfjs/${dir}`, {
          recursive: true,
          // Runs a PDF's scripts, which are off here.
          filter: (src: string) => !src.includes("quickjs"),
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // `scripts/sandbox.sh up` picks another, beside a dev build already running.
    port: Number(process.env.OBSERVATORY_DEV_PORT) || 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
