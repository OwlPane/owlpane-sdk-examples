#!/usr/bin/env bash
# Forward Hetzner owlpane-ingest to localhost for SaaS dogfood (see .env.production-saas.bak).
#
# Env:
#   OWLPANE_SAAS_PF_WATCH_SEC   sleep between health checks in `watch` (default 30)
#   OWLPANE_SAAS_INGEST_LOCAL_PORT  local bind (default 14318 → svc 4318)
set -euo pipefail
CTX="${KUBE_CTX:-crikiq-hetzner}"
NS="${OWLPANE_NAMESPACE:-owlpane-platform}"
LOCAL_PORT="${OWLPANE_SAAS_INGEST_LOCAL_PORT:-14318}"
PIDFILE="${OWLPANE_SAAS_PF_PIDFILE:-/tmp/owlpane-saas-ingest-pf.pid}"
WATCH_SEC="${OWLPANE_SAAS_PF_WATCH_SEC:-30}"
HEALTH_URL="http://127.0.0.1:${LOCAL_PORT}/healthz"

health_ok() {
  curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1
}

pf_check() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && health_ok; then
    return 0
  fi
  return 1
}

case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      if health_ok; then
        echo "port-forward already running (pid $(cat "$PIDFILE") → 127.0.0.1:${LOCAL_PORT})"
        exit 0
      fi
      echo "stale port-forward (healthz failed) — restarting…" >&2
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    kubectl --context "$CTX" -n "$NS" port-forward "svc/owlpane-ingest" "${LOCAL_PORT}:4318" &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 15); do
      curl -fsS -m 2 "http://127.0.0.1:${LOCAL_PORT}/healthz" >/dev/null && break
      sleep 1
    done
    curl -fsS "http://127.0.0.1:${LOCAL_PORT}/healthz" >/dev/null
    echo "SaaS ingest → http://127.0.0.1:${LOCAL_PORT} (pid $(cat "$PIDFILE"))"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    pkill -f "port-forward svc/owlpane-ingest ${LOCAL_PORT}:4318" 2>/dev/null || true
    echo "stopped"
    ;;
  status)
    if pf_check; then
      echo "running pid $(cat "$PIDFILE")"
      curl -fsS "$HEALTH_URL" && echo
    else
      echo "not running"
      exit 1
    fi
    ;;
  check)
    if pf_check; then
      echo "ok pid $(cat "$PIDFILE") → $HEALTH_URL"
      exit 0
    fi
    echo "port-forward dead or healthz failed — run: $0 start" >&2
    exit 1
    ;;
  watch)
    echo "watching ingest PF every ${WATCH_SEC}s ($HEALTH_URL)"
    while true; do
      if ! pf_check; then
        reason=healthz_fail
        if [ ! -f "$PIDFILE" ] || ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
          reason=pid_dead
        fi
        "$0" stop >/dev/null 2>&1 || true
        "$0" start
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restarted port-forward reason=$reason"
      fi
      sleep "$WATCH_SEC"
    done
    ;;
  *) echo "Usage: $0 start|stop|status|check|watch" >&2; exit 1 ;;
esac
