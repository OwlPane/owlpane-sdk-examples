# Conformance samples (local receiver only)

These programs validate the OTLP + `Bearer owl_ing_` contract against [`../_receiver/receiver.mjs`](../_receiver/receiver.mjs). They never call a real Owlpane ingest endpoint. Used by `npm test` (via `packages/go` and `packages/python` conformance scripts) and API reference docs.

| Sample | Run |
|--------|-----|
| [node](node) | `./run.sh` |
| [python](python) | `./run.sh` |
| [go](go) | `./run.sh` |
| [java](java) | `./run.sh` |
