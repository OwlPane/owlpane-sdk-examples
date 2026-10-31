import os
import time
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from owlpane import shutdown, start

fn = start()
if fn is None:
    raise SystemExit("owlpane did not start — check examples/.env")

rich_mode = os.environ.get("OWLPANE_DOGFOOD_MODE") == "rich"
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

    with tracer.start_as_current_span(
        "POST /checkout",
        kind=trace.SpanKind.SERVER,
        attributes={"http.request.method": "POST", "http.route": "/checkout", "http.response.status_code": 500},
    ) as err_span:
        err = RuntimeError("Inventory reservation failed for SKU-42")
        err_span.record_exception(err)
        err_span.set_status(Status(StatusCode.ERROR, str(err)))

metrics_sleep = int(os.environ.get("OWLPANE_DOGFOOD_METRICS_SLEEP_SEC", "6"))
if metrics_sleep > 0:
    time.sleep(metrics_sleep)

shutdown()

print(
    f"span{' + rich trace' if rich_mode else ''} emitted ({os.environ.get('OTEL_SERVICE_NAME', 'owlpane-sdk-python')})"
)
