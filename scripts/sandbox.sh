#!/bin/bash
# A throwaway nebula daemon for developing this app without touching your
# real sessions: its own socket, database and settings, two demo repos, and a
# fake agent CLI that fires nebula's status hooks instead of calling a model.
#
#   scripts/sandbox.sh start   # boot it (idempotent)
#   scripts/sandbox.sh app     # run the app in dev mode against it
#   scripts/sandbox.sh up      # the same in the background, ready for scripts/drive
#   scripts/sandbox.sh down    # stop what `up` started
#   scripts/sandbox.sh e2e     # protocol test: worktree, agent, attach, statuses
#   scripts/sandbox.sh stop    # stop the sandbox daemon (never the real one)
#   scripts/sandbox.sh automations        # install a throwaway launchd job
#   scripts/sandbox.sh automations-clean  # remove it
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="${NEBULA_SANDBOX:-$PWD/.sandbox}"
# Unix socket paths are capped near 104 bytes on macOS, so the socket lives
# in a short directory of its own.
export NEBULA_RUNTIME_DIR=/tmp/observatory-sandbox
export NEBULA_DATA_DIR="$ROOT/data"
export NEBULA_AGENT_CMD="$PWD/scripts/fake-agent.sh"
# The dev build listens here for scripts/drive (control.rs).
export OBSERVATORY_CONTROL="$NEBULA_RUNTIME_DIR/control.sock"

start() {
  mkdir -p "$NEBULA_DATA_DIR" "$NEBULA_RUNTIME_DIR"
  chmod 700 "$NEBULA_RUNTIME_DIR"
  if [ -S "$NEBULA_RUNTIME_DIR/daemon.sock" ] && kill -0 "$(cat "$NEBULA_RUNTIME_DIR/daemon.pid" 2>/dev/null)" 2>/dev/null; then
    echo "sandbox daemon already running"
  else
    nohup nebula daemon >/dev/null 2>&1 &
    for _ in $(seq 1 50); do [ -S "$NEBULA_RUNTIME_DIR/daemon.sock" ] && break; sleep 0.1; done
    echo "sandbox daemon up (socket $NEBULA_RUNTIME_DIR/daemon.sock)"
  fi
  for r in demo-api demo-web; do
    local dir="$ROOT/repos/$r"
    if [ ! -d "$dir/.git" ]; then
      mkdir -p "$dir" && git -C "$dir" init -q -b main
      echo "# $r" > "$dir/README.md"
      git -C "$dir" add -A && git -C "$dir" -c user.email=sandbox@local -c user.name=sandbox commit -qm init
      nebula add "$dir" >/dev/null
    fi
  done
}

stop() {
  local pid
  pid=$(cat "$NEBULA_RUNTIME_DIR/daemon.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" && echo "stopped sandbox daemon $pid"
  else
    echo "sandbox daemon not running"
  fi
}

# A throwaway launchd agent for the Automations view: it echoes a line to a
# log every 10 minutes. The log sits in the runtime folder, not under
# ~/Documents, where macOS can block a launchd job from writing.
JOB=com.observatory.sandbox-job
JOB_PLIST="$HOME/Library/LaunchAgents/$JOB.plist"
JOB_DIR="$NEBULA_RUNTIME_DIR/automations"

automations() {
  mkdir -p "$JOB_DIR" "$(dirname "$JOB_PLIST")"
  cat > "$JOB_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$JOB</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/sh</string>
		<string>-c</string>
		<string>echo "sandbox job ran at \$(date '+%Y-%m-%d %H:%M:%S')"</string>
	</array>
	<key>StartInterval</key>
	<integer>600</integer>
	<key>StandardOutPath</key>
	<string>$JOB_DIR/sandbox-job.log</string>
	<key>StandardErrorPath</key>
	<string>$JOB_DIR/sandbox-job.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$JOB" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$JOB_PLIST"
  echo "installed $JOB (log $JOB_DIR/sandbox-job.log)"
}

automations_clean() {
  launchctl bootout "gui/$(id -u)/$JOB" 2>/dev/null || true
  rm -f "$JOB_PLIST"
  rm -rf "$JOB_DIR"
  echo "removed $JOB"
}

# The app in the background, its log in the sandbox, back once scripts/drive
# can reach it (the first build takes minutes).
up() {
  start
  if scripts/drive state >/dev/null 2>&1; then echo "app already up"; return; fi
  # Vite's port, past any dev build already running (the usual one is 1420).
  local port=1430
  while (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done
  local config="{\"build\":{\"devUrl\":\"http://localhost:$port\"}}"
  # Linux with no screen (the always-on PC over ssh): a virtual one, the
  # size of a laptop window, for the app and its screenshots.
  if [ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}" ]; then
    OBSERVATORY_DEV_PORT=$port nohup xvfb-run -a -s "-screen 0 1440x900x24" npm run tauri dev -- --config "$config" >"$ROOT/app.log" 2>&1 &
  else
    OBSERVATORY_DEV_PORT=$port nohup npm run tauri dev -- --config "$config" >"$ROOT/app.log" 2>&1 &
  fi
  echo $! >"$ROOT/app.pid"
  for _ in $(seq 1 600); do
    scripts/drive state >/dev/null 2>&1 && { echo "app up (log $ROOT/app.log)"; return; }
    kill -0 "$(cat "$ROOT/app.pid")" 2>/dev/null || { echo "app exited; see $ROOT/app.log" >&2; tail -20 "$ROOT/app.log" >&2; exit 1; }
    sleep 1
  done
  echo "app not reachable after 10 minutes; see $ROOT/app.log" >&2
  exit 1
}

killtree() {
  local child
  for child in $(pgrep -P "$1"); do killtree "$child"; done
  kill "$1" 2>/dev/null || true
}

down() {
  local pid
  pid=$(cat "$ROOT/app.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # npm starts tauri, which starts vite and the app: stop all of them,
    # deepest first, or the app outlives its parents.
    killtree "$pid"
    echo "stopped the app"
  else
    echo "app not running"
  fi
  rm -f "$ROOT/app.pid"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  app) start && npm run tauri dev ;;
  up) up ;;
  down) down ;;
  e2e) start && (cd src-tauri && cargo run -q --example e2e) ;;
  automations) automations ;;
  automations-clean) automations_clean ;;
  *) echo "usage: $0 start|app|up|down|e2e|stop|automations|automations-clean" >&2; exit 2 ;;
esac
