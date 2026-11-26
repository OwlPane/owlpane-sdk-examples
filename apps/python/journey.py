"""A storefront checkout as one distributed trace: web -> cart, inventory, payments -> notifications, 16+ spans.

Spans carry explicit start and end times, so a batch of journeys is emitted at once with realistic durations. One payment provider
is slow on purpose and out-of-stock items fail the request, so latency and error views have a real pattern to find.
"""

import random
import time
from typing import Callable, Optional

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import SpanKind, Status, StatusCode

MS = 1_000_000
SERVICES = ("dogfood-cart", "dogfood-inventory", "dogfood-payments", "dogfood-notify")


def service_tracers(base: trace.TracerProvider) -> dict:
    """One tracer per service, all exporting through the started provider. Falls back to one service if the SDK hides it."""
    processor = getattr(base, "_active_span_processor", None)
    resource = getattr(base, "resource", None)
    tracers = {"web": base.get_tracer("owlpane-dogfood-journey")}
    for name in SERVICES:
        if processor is None or resource is None:
            tracers[name] = tracers["web"]
            continue
        provider = TracerProvider(resource=resource.merge(Resource.create({"service.name": name})), shutdown_on_exit=False)
        provider.add_span_processor(processor)
        tracers[name] = provider.get_tracer("owlpane-dogfood-journey")
    return tracers


class Timeline:
    """Spans placed on a clock in nanoseconds; `span` returns the end time so siblings can follow one another."""

    def __init__(self, tracers: dict):
        self.tracers = tracers

    def span(
        self,
        service: str,
        name: str,
        start: int,
        ms: float,
        kind: SpanKind = SpanKind.INTERNAL,
        attrs: Optional[dict] = None,
        parent=None,
        children: Optional[Callable[[object, int], int]] = None,
        error: Optional[str] = None,
    ) -> int:
        ctx = trace.set_span_in_context(parent) if parent is not None else None
        s = self.tracers[service].start_span(name, context=ctx, kind=kind, attributes=attrs or {}, start_time=start)
        end = start + int(ms * MS)
        if children:
            end = max(end, children(s, start + int(0.2 * MS)))
        if error:
            exc = RuntimeError(error)
            s.record_exception(exc, timestamp=end)
            s.set_status(Status(StatusCode.ERROR, error))
        s.end(end_time=end)
        return end


def journey(t: Timeline, rng: random.Random, start: int) -> None:
    provider = "globex-pay" if rng.random() < 0.3 else "acme-pay"
    slow_payment = provider == "globex-pay" and rng.random() < 0.7
    items = rng.randint(1, 4)
    out_of_stock = rng.random() < 0.08
    user_tier = rng.choice(["free", "free", "pro", "enterprise"])
    status = 409 if out_of_stock else 200

    def web(root, at):
        at = t.span("web", "middleware auth", at, rng.uniform(0.4, 1.5), parent=root)
        at = t.span("web", "SELECT users", at, rng.uniform(1, 4), SpanKind.CLIENT, {"db.system": "postgresql", "db.operation.name": "SELECT", "db.collection.name": "users"}, root)

        def cart_client(c, a):
            def cart_server(s, b):
                b = t.span("dogfood-cart", "GET cart:{id}", b, rng.uniform(0.3, 1.2), SpanKind.CLIENT, {"db.system": "redis", "db.operation.name": "GET"}, s)
                return t.span("dogfood-cart", "price items", b, rng.uniform(2, 6), parent=s, attrs={"cart.items": items})
            return t.span("dogfood-cart", "GET /cart/{id}", a + MS // 2, 1, SpanKind.SERVER, {"http.request.method": "GET", "http.route": "/cart/{id}", "http.response.status_code": 200}, c, cart_server)

        at = t.span("web", "GET dogfood-cart", at, 1, SpanKind.CLIENT, {"http.request.method": "GET", "server.address": "dogfood-cart"}, root, cart_client)

        def inv_client(c, a):
            def inv_server(s, b):
                for i in range(items):
                    b = t.span("dogfood-inventory", "SELECT stock", b, rng.uniform(1, 3), SpanKind.CLIENT, {"db.system": "postgresql", "db.operation.name": "SELECT", "db.collection.name": "stock", "item.index": i}, s)
                if out_of_stock:
                    return t.span("dogfood-inventory", "reserve stock", b, 0.5, parent=s, error="Out of stock for SKU-42")
                return t.span("dogfood-inventory", "UPDATE stock", b, rng.uniform(2, 5), SpanKind.CLIENT, {"db.system": "postgresql", "db.operation.name": "UPDATE", "db.collection.name": "stock"}, s)
            return t.span("dogfood-inventory", "POST /reserve", a + MS // 2, 1, SpanKind.SERVER, {"http.request.method": "POST", "http.route": "/reserve", "http.response.status_code": 409 if out_of_stock else 200}, c, inv_server, "Out of stock" if out_of_stock else None)

        at = t.span("web", "POST dogfood-inventory", at, 1, SpanKind.CLIENT, {"http.request.method": "POST", "server.address": "dogfood-inventory"}, root, inv_client)
        if out_of_stock:
            return at

        def pay_client(c, a):
            def pay_server(s, b):
                b = t.span("dogfood-payments", "fraud score", b, rng.uniform(3, 9), parent=s, attrs={"user.tier": user_tier})
                gateway = rng.uniform(600, 1500) if slow_payment else rng.uniform(40, 140)
                return t.span("dogfood-payments", f"POST {provider}", b, gateway, SpanKind.CLIENT, {"http.request.method": "POST", "server.address": f"api.{provider}.example", "payment.provider": provider}, s)
            return t.span("dogfood-payments", "POST /charge", a + MS // 2, 1, SpanKind.SERVER, {"http.request.method": "POST", "http.route": "/charge", "http.response.status_code": 200, "payment.provider": provider}, c, pay_server)

        at = t.span("web", "POST dogfood-payments", at, 1, SpanKind.CLIENT, {"http.request.method": "POST", "server.address": "dogfood-payments", "payment.provider": provider}, root, pay_client)
        at = t.span("web", "INSERT orders", at, rng.uniform(2, 6), SpanKind.CLIENT, {"db.system": "postgresql", "db.operation.name": "INSERT", "db.collection.name": "orders"}, root)

        def publish(p, a):
            def consume(s, b):
                b = t.span("dogfood-notify", "render receipt", b, rng.uniform(2, 8), parent=s)
                return t.span("dogfood-notify", "SMTP send", b, rng.uniform(20, 80), SpanKind.CLIENT, {"server.address": "smtp.example"}, s)
            return t.span("dogfood-notify", "process order.created", a + 2 * MS, 1, SpanKind.CONSUMER, {"messaging.system": "redis", "messaging.destination.name": "order.created"}, p, consume)

        return t.span("web", "publish order.created", at, 0.8, SpanKind.PRODUCER, {"messaging.system": "redis", "messaging.destination.name": "order.created"}, root, publish)

    t.span(
        "web",
        "POST /checkout",
        start,
        1,
        SpanKind.SERVER,
        {"http.request.method": "POST", "http.route": "/checkout", "http.response.status_code": status, "payment.provider": provider, "user.tier": user_tier, "cart.items": items},
        None,
        web,
        "Inventory reservation failed for SKU-42" if out_of_stock else None,
    )


def emit_journeys(base: trace.TracerProvider, count: int, seed: Optional[int] = None) -> int:
    """Emit `count` checkouts spread over the last minute; returns how many were emitted."""
    rng = random.Random(seed)
    t = Timeline(service_tracers(base))
    now = time.time_ns()
    for i in range(count):
        journey(t, rng, now - int(rng.uniform(0, 60_000)) * MS)
    return count
