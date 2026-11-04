// PDFs through pdf.js. WebKit's own viewer stops at the first page inside a
// frame, which is the only place the app can put it. Loaded on the first PDF
// opened, since it's a megabyte of code most sessions never need.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/** The files pdf.js fetches for itself: decoders for scanned pages, fonts a
 *  PDF left out. The build copies them to dist/pdfjs (vite.config.ts). */
const assets = () => new URL(import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "/pdfjs/", location.href).href;

export type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

export async function openPdf(data: ArrayBuffer) {
  const lib: Pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  const base = assets();
  const task = lib.getDocument({
    data,
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}iccs/`,
  });
  // `close` ends the worker with the document.
  const close = () => void task.destroy();
  try {
    return { lib, doc: await task.promise, close };
  } catch (e) {
    close();
    throw e;
  }
}
