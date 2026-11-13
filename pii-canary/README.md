# PII canary

Synthetic service that emits email, payment-card, bearer-token, and raw-SQL-shaped telemetry so you can compare those fixtures with what Search shows.

The process sends the strings in `src/main.ts` as written. Owlpane's API redacts those shapes when telemetry text is shown or exported. The stored body is the payload this process sent. A redacted row in Search is the read path; compare it with the fixture if you are checking that behaviour.

## Run

```bash
export OWLPANE_ENDPOINT=http://127.0.0.1:4319
export OWLPANE_INGEST_KEY=owl_ing_…   # pii-canary or dev project
./run.sh
```

Manual burst: `curl -X POST http://127.0.0.1:5199/emit`

## What to look at

After 1–2 minutes, open **Search → Logs** and **Requests** filtered to service `pii-canary`. Compare the on-screen text with `src/main.ts`. Where read-path redaction is applied, Search shows `[email]`, `[number]`, `Bearer [token]`, and SQL with `?` literals.

Fixtures use `example.com`, the common test card number, and a bearer value that has no signature.
