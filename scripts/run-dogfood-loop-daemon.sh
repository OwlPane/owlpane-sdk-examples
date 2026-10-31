#!/usr/bin/env bash
# Detached continuous dogfood: demo-server (Node.js) + runtime ticker (all other runtimes ~every 45s).
#   ./scripts/run-dogfood-loop-daemon.sh start|stop|status|restart
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO_PIDFILE="${OWLPANE_DEMO_PIDFILE:-/tmp/owlpane-demo-server.pid}"
TICKER_PIDFILE="${OWLPANE_RUNTIME_TICKER_PIDFILE:-/tmp/owlpane-runtime-ticker.pid}"
DEMO_LOG="${OWLPANE_DEMO_LOG:-/tmp/owlpane-demo-server.log}"
TICKER_LOG="${OWLPANE_RUNTIME_TICKER_LOG:-/tmp/owlpane-runtime-ticker.log}"

read_pid() {
  local f="$1"
  if [ -f "$f" ]; then tr -d ' \n' < "$f"; fi
}

running_pid() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

find_listener_pid() {
  lsof -t -iTCP:4399 -sTCP:LISTEN 2>/dev/null | head -1 || true
}

ensure_env() {
  if [ -f "$ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
  fi
  export OWLPANE_API_URL="${OWLPANE_API_URL:-http://127.0.0.1:4100}"
  export OWLPANE_INGEST_URL="${OWLPANE_INGEST_URL:-http://127.0.0.1:4318}"
  export OWLPANE_ENVIRONMENT="${OWLPANE_ENVIRONMENT:-development}"
  export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
  if [ ! -f "$ROOT/.env" ] || ! grep -q '^OWLPANE_INGEST_KEY_NODE=owl_ing_' "$ROOT/.env" 2>/dev/null; then
    "$ROOT/scripts/onboard-dogfood.sh" --write-env
  fi
}

start_ticker() {
  local pid
  pid="$(read_pid "$TICKER_PIDFILE")"
  if running_pid "$pid"; then
    echo "runtime ticker already running (pid $pid, log $TICKER_LOG)"
    return 0
  fi
  chmod +x "$ROOT/scripts/run-dogfood-runtime-ticker.sh" "$ROOT"/apps/*/run.sh 2>/dev/null || true
  echo "Starting runtime ticker → ${OWLPANE_INGEST_URL} every ${DOGFOOD_RUNTIME_TICK_SEC:-45}s (log $TICKER_LOG)"
  {
    echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) runtime-ticker start ---"
    exec "$ROOT/scripts/run-dogfood-runtime-ticker.sh"
  } >> "$TICKER_LOG" 2>&1 &
  echo $! > "$TICKER_PIDFILE"
  echo "runtime ticker started (pid $(read_pid "$TICKER_PIDFILE"), log $TICKER_LOG)"
}

stop_ticker() {
  local pid
  pid="$(read_pid "$TICKER_PIDFILE")"
  if running_pid "$pid"; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    running_pid "$pid" && kill -9 "$pid" 2>/dev/null || true
  fi
  pkill -f "run-dogfood-runtime-ticker.sh" 2>/dev/null || true
  rm -f "$TICKER_PIDFILE"
}

start_demo() {
  local pid
  pid="$(read_pid "$DEMO_PIDFILE")"
  if running_pid "$pid"; then
    echo "demo-server already running (pid $pid, log $DEMO_LOG)"
    return 0
  fi
  pid="$(find_listener_pid)"
  if [ -n "$pid" ]; then
    echo "$pid" > "$DEMO_PIDFILE"
    echo "demo-server already listening on :4399 (pid $pid, log $DEMO_LOG)"
    return 0
  fi

  echo "Starting continuous demo-server → ${OWLPANE_INGEST_URL} (log $DEMO_LOG)"
  {
    echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) demo-server start ---"
    exec "$ROOT/apps/demo-server/run.sh"
  } >> "$DEMO_LOG" 2>&1 &
  echo $! > "$DEMO_PIDFILE"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 1
    pid="$(find_listener_pid)"
    if [ -n "$pid" ]; then
      echo "$pid" > "$DEMO_PIDFILE"
      echo "demo-server started (pid $pid, http://127.0.0.1:4399, log $DEMO_LOG)"
      return 0
    fi
  done
  echo "demo-server failed to start; see $DEMO_LOG" >&2
  tail -25 "$DEMO_LOG" >&2 || true
  rm -f "$DEMO_PIDFILE"
  return 1
}

stop_demo() {
  local pid
  pid="$(read_pid "$DEMO_PIDFILE")"
  if running_pid "$pid"; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    running_pid "$pid" && kill -9 "$pid" 2>/dev/null || true
  fi
  pid="$(find_listener_pid)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
  pkill -f "apps/demo-server/run.sh" 2>/dev/null || true
  rm -f "$DEMO_PIDFILE"
}

start() {
  ensure_env
  start_ticker
  start_demo
}

stop() {
  stop_demo
  stop_ticker
  echo "dogfood loop stopped (demo-server + runtime ticker)"
}

status() {
  local ok=0
  local pid
  pid="$(read_pid "$TICKER_PIDFILE")"
  if running_pid "$pid"; then
    echo "runtime ticker: running pid=$pid log=$TICKER_LOG"
  else
    echo "runtime ticker: not running"
    ok=1
  fi
  pid="$(read_pid "$DEMO_PIDFILE")"
  if running_pid "$pid" || [ -n "$(find_listener_pid)" ]; then
    pid="${pid:-$(find_listener_pid)}"
    echo "demo-server: running pid=$pid log=$DEMO_LOG"
    curl -sf "http://127.0.0.1:4399/demo" 2>/dev/null | head -c 120 || true
    echo
  else
    echo "demo-server: not running"
    ok=1
  fi
  return "$ok"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  fg|foreground)
    stop
    exec "$ROOT/scripts/run-dogfood-foreground.sh"
    ;;
  logs)
    echo "=== runtime ticker ($TICKER_LOG) ==="
    tail -f "$TICKER_LOG" &
    tp=$!
    echo "=== demo-server ($DEMO_LOG) ==="
    tail -f "$DEMO_LOG" &
    dp=$!
    trap "kill $tp $dp 2>/dev/null" INT TERM
    wait
    ;;
  *)
    echo "Usage: $0 {start|stop|status|restart|fg|logs}" >&2
    echo "  fg    run demo + ticker in this terminal (Ctrl+C)" >&2
    echo "  logs  tail -f both log files (when started with start)" >&2
    exit 1
    ;;
esac
