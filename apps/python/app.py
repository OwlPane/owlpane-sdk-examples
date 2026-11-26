import os
import time
from opentelemetry import trace

from owlpane import shutdown, start

from journey import emit_journeys

fn = start()
if fn is None:
    raise SystemExit("owlpane did not start — check examples/.env")

rich_mode = os.environ.get("OWLPANE_DOGFOOD_MODE") == "rich"
journeys = 0
tracer = trace.get_tracer("owlpane-dogfood")

with tracer.start_as_current_span(
    "GET /demo",
    kind=trace.SpanKind.SERVER,
    attributes={"http.request.method": "GET", "http.route": "/demo", "http.response.status_code": 200},
):
    time.sleep(0.03)
    if rich_mode:
        with tracer.start_as_current_span(
            "SELECT orders",
            kind=trace.SpanKind.CLIENT,
            attributes={"db.system": "postgresql", "db.operation.name": "SELECT"},
        ):
            time.sleep(0.01)

if rich_mode:
    with tracer.start_as_current_span(
        "celery.process orders.ship",
        kind=trace.SpanKind.SERVER,
        attributes={
            "http.request.method": "POST",
            "http.route": "/internal/celery",
            "messaging.system": "redis",
            "messaging.destination.name": "celery",
        },
    ):
        time.sleep(0.01)

    journeys = emit_journeys(trace.get_tracer_provider(), int(os.environ.get("OWLPANE_DOGFOOD_JOURNEYS", "40")))

metrics_sleep = int(os.environ.get("OWLPANE_DOGFOOD_METRICS_SLEEP_SEC", "6"))
if metrics_sleep > 0:
    time.sleep(metrics_sleep)

shutdown()

print(
    f"span{f' + {journeys} checkout journeys' if rich_mode else ''} emitted ({os.environ.get('OTEL_SERVICE_NAME', 'owlpane-sdk-python')})"
)
