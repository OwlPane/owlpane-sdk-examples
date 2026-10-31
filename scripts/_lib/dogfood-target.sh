#!/usr/bin/env bash
# True local: OTLP → host ingest (usually :4318) + API on localhost.
# SaaS: OTLP → :14318 port-forward to remote owlpane-ingest (see .env.saas.example).

dogfood_is_saas() {
  case "${OWLPANE_INGEST_URL:-}" in
    *:14318|*:14318/*) return 0 ;;
  esac
  case "${OWLPANE_DOGFOOD_TARGET:-}" in
    saas|remote|prod) return 0 ;;
  esac
  return 1
}

dogfood_print_target() {
  if dogfood_is_saas; then
    echo "[dogfood] target=SAAS  ingest=${OWLPANE_INGEST_URL:-?} (port-forward)  api=${OWLPANE_API_URL:-?}"
  else
    echo "[dogfood] target=LOCAL ingest=${OWLPANE_INGEST_URL:-http://127.0.0.1:4318}  api=${OWLPANE_API_URL:-http://127.0.0.1:4100}"
  fi
}
