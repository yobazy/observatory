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

# The app in the background, its log in the sandbox, back once scripts/drive
# can reach it (the first build takes minutes).
up() {
  start
  if scripts/drive state >/dev/null 2>&1; then echo "app already up"; return; fi
  # Vite's port, past any dev build already running (the usual one is 1420).
  local port=1430
  while lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done
  OBSERVATORY_DEV_PORT=$port nohup npm run tauri dev -- --config "{\"build\":{\"devUrl\":\"http://localhost:$port\"}}" >"$ROOT/app.log" 2>&1 &
  echo $! >"$ROOT/app.pid"
  for _ in $(seq 1 600); do
    scripts/drive state >/dev/null 2>&1 && { echo "app up (log $ROOT/app.log)"; return; }
    kill -0 "$(cat "$ROOT/app.pid")" 2>/dev/null || { echo "app exited; see $ROOT/app.log" >&2; tail -20 "$ROOT/app.log" >&2; exit 1; }
    sleep 1
  done
  echo "app not reachable after 10 minutes; see $ROOT/app.log" >&2
  exit 1
}

down() {
  local pid
  pid=$(cat "$ROOT/app.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # npm, then tauri, then the app: stop the whole group.
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    pkill -f "$PWD/src-tauri/target/debug/observatory" 2>/dev/null || true
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
  *) echo "usage: $0 start|app|up|down|e2e|stop" >&2; exit 2 ;;
esac
