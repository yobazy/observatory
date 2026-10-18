import { useEffect, useState } from "react";
import {
  installNebula,
  nebulaStatus,
  reconnectNow,
  restartDaemon,
  startDaemon,
  startError,
  staleDaemon,
  type NebulaStatus,
  type StaleDaemon,
} from "../nebula/client";
import { useAppState } from "../nebula/store";
import { openLink } from "./Run";
import { Telescope } from "./Welcome";

const RELEASES = "https://github.com/yobazy/observatory/releases";

/** -1, 0 or 1 as version `a` is older than, equal to or newer than `b`. */
function compare(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Covers the app until the first Snapshot arrives, and turns what's wrong —
 *  no nebula, the wrong nebula, nebula not running, or an old one still
 *  running out of reach — into the fix, done here: the app installs the
 *  nebula it's built for itself, and restarts one it can't reach. */
export function DaemonGate() {
  const { link, loaded } = useAppState();
  const [status, setStatus] = useState<NebulaStatus | null>(null);
  const [busy, setBusy] = useState<"install" | "start" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<StaleDaemon | null>(null);
  const [confirming, setConfirming] = useState(false);
  const down = !loaded && link.state === "disconnected";

  useEffect(() => {
    if (!down) return;
    void nebulaStatus().then(setStatus).catch((e) => setError(String(e)));
    void staleDaemon().then(setStale).catch(() => {});
  }, [down]);

  if (!down) return null;

  /** A start that failed: an old nebula out of reach gets its own screen;
   *  anything else is said under the copy. */
  const failed = (e: unknown) => {
    const err = startError(e);
    if (err.kind === "stale") {
      setStale({ pid: err.pid, sessions: err.sessions });
      return;
    }
    setError(err.message);
    void staleDaemon().then(setStale).catch(() => {});
  };

  /** Started and stayed up: connect, still "Starting…" until the window does. */
  const started = () => {
    setTimeout(reconnectNow, 300);
    setTimeout(() => setBusy(null), 3000);
  };

  const start = async () => {
    setBusy("start");
    setError(null);
    try {
      await startDaemon();
      started();
    } catch (e) {
      failed(e);
      setBusy(null);
    }
  };

  const install = async () => {
    setBusy("install");
    setError(null);
    try {
      setStatus(await installNebula());
    } catch (e) {
      setError(`Couldn't install nebula: ${e}`);
      setBusy(null);
      return;
    }
    // Installed: carry straight on to starting it, so it's one click.
    try {
      await startDaemon();
      started();
    } catch (e) {
      failed(e);
      setBusy(null);
    }
  };

  const restart = async (pid: number) => {
    setBusy("restart");
    setConfirming(false);
    setError(null);
    try {
      await restartDaemon(pid);
      setStale(null);
      started();
    } catch (e) {
      failed(e);
      setBusy(null);
    }
  };

  const mismatch = link.reason.includes("protocol");
  const pinned = status?.pinned ?? "";
  const order = status?.version ? compare(status.version, pinned) : 0;

  let title = "nebula isn’t running";
  let body: React.ReactNode = (
    <p>
      Start it here, or run <code>nebula</code> in a terminal. This window connects on its own once
      it’s up.
    </p>
  );
  let action: React.ReactNode = (
    <button className="btn btn-primary" disabled={!!busy} onClick={() => void start()}>
      {busy === "start" || busy === "restart" ? "Starting…" : "Start nebula"}
    </button>
  );

  if (stale) {
    title = "nebula can’t be reached";
    body = (
      <>
        <p>
          An older nebula is still running (pid {stale.pid}), but this window can’t reach it. Restart it to
          connect.
        </p>
        {confirming && (
          <p>
            {stale.sessions
              ? `It’s running ${plural(stale.sessions, "agent session")}. Restarting ends them.`
              : "It isn’t running any agent sessions, so nothing is lost."}
          </p>
        )}
      </>
    );
    action = confirming ? (
      <>
        <button className="btn btn-danger" onClick={() => void restart(stale.pid)}>
          {stale.sessions ? `Restart and end ${plural(stale.sessions, "session")}` : "Restart nebula"}
        </button>
        <button className="btn" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </>
    ) : (
      <button className="btn btn-primary" disabled={!!busy} onClick={() => setConfirming(true)}>
        {busy === "restart" ? "Restarting…" : "Restart nebula"}
      </button>
    );
  } else if (status && !status.path) {
    title = "Set up nebula";
    body = (
      <p>
        Observatory runs your coding agents through nebula, which isn’t installed yet. This
        installs nebula {pinned} into <code>~/.local/bin</code>, the same place nebula’s own installer
        uses, and starts it.
      </p>
    );
    action = (
      <button className="btn btn-primary" disabled={!!busy} onClick={() => void install()}>
        {busy === "install" ? "Installing…" : `Install nebula ${pinned}`}
      </button>
    );
  } else if (status?.version && order < 0) {
    title = `nebula ${status.version} is older than this app`;
    body = (
      <p>
        This app is built for nebula {pinned}. Updating replaces <code>{status.path}</code>.
        {mismatch && " The daemon that's running stays on the old version until it restarts: quit it with nebula kill in a terminal once your agents are idle, since that stops every session."}
      </p>
    );
    action = (
      <button className="btn btn-primary" disabled={!!busy} onClick={() => void install()}>
        {busy === "install" ? "Updating…" : `Update nebula to ${pinned}`}
      </button>
    );
  } else if (status?.version && order > 0 && mismatch) {
    // Newer only matters when it changed the protocol: a newer nebula that
    // speaks this app's protocol just needs starting.
    title = "Observatory needs an update";
    body = (
      <p>
        Your nebula is {status.version}, and this app is built for {pinned}. This nebula talks a
        newer protocol than this app knows, so get a newer Observatory.
      </p>
    );
    action = (
      <button className="btn btn-primary" onClick={() => void openLink(RELEASES)}>
        Get the latest app
      </button>
    );
  } else if (mismatch) {
    title = "This app and your nebula don’t match";
    body = <p>{link.reason}</p>;
    action = null;
  }

  return (
    <div className="gate" data-tauri-drag-region>
      <div className="gate-card">
        <Telescope mode={busy ? "scan" : "rest"} size={150} />
        <h1>{title}</h1>
        {body}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="gate-actions">
          {action}
          {!confirming && (
            <button
              className="btn"
              onClick={() => {
                reconnectNow();
                void staleDaemon().then(setStale).catch(() => {});
              }}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
