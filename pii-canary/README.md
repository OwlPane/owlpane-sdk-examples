# PII canary

Synthetic service that **intentionally** emits email, card, bearer-token, and raw-SQL-shaped telemetry so you can verify Owlpane scrubbing and API redaction.

## Run

```bash
export OWLPANE_ENDPOINT=http://127.0.0.1:4319
export OWLPANE_INGEST_KEY=owl_ing_…   # pii-canary or dev project
./run.sh
```

Manual burst: `curl -X POST http://127.0.0.1:5199/emit`

## Verify in Owlpane

After 1–2 minutes, open **Search → Logs** and **Requests** filtered to service `pii-canary`. You should see `[email]`, `[number]`, `Bearer [token]`, and SQL with `?` literals — not the fixture strings from `src/main.ts`.

Automated check from repo root:

```bash
./scripts/verify-pii-redaction.sh
```
