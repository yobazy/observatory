import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
// The other terminal faces (termfont.ts), Latin only: each loads on first use.
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-700.css";
import "@fontsource/commit-mono/latin-400.css";
import "@fontsource/commit-mono/latin-700.css";
import "@fontsource/iosevka/latin-400.css";
import "@fontsource/iosevka/latin-700.css";
import "@fontsource/cascadia-code/latin-400.css";
import "@fontsource/cascadia-code/latin-700.css";
import "@fontsource/fira-code/latin-400.css";
import "@fontsource/fira-code/latin-700.css";
import "@fontsource/source-code-pro/latin-400.css";
import "@fontsource/source-code-pro/latin-700.css";
import "@fontsource/roboto-mono/latin-400.css";
import "@fontsource/roboto-mono/latin-700.css";
import "./styles.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { startUseLog } from "./nebula/uselog";
import { startMoments } from "./nebula/moments";
import { startLinks } from "./nebula/links";

startUseLog();
startMoments();
startLinks();
// The control socket an agent drives the dev build with (control.ts); a
// release build leaves it out.
if (import.meta.env.DEV && "__TAURI_INTERNALS__" in globalThis) void import("./nebula/control").then((m) => m.startControl());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
