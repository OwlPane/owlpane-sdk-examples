# Conformance samples (local receiver only)

These programs validate the OTLP + `Authorization: Bearer owl_ing_EXAMPLE` contract against [`../_receiver/receiver.mjs`](../_receiver/receiver.mjs). `owl_ing_EXAMPLE` is a local placeholder for that receiver. They never call a real Owlpane ingest endpoint. Used by `npm test` (via `packages/go` and `packages/python` conformance scripts) and API reference docs.

| Sample | Run |
|--------|-----|
| [node](node) | `./run.sh` |
| [python](python) | `./run.sh` |
| [go](go) | `./run.sh` |
| [java](java) | `./run.sh` |
