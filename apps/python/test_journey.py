"""python -m unittest test_journey  (from apps/python, with opentelemetry-sdk installed)."""

import unittest
from collections import Counter, defaultdict

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.resources import Resource

from journey import emit_journeys


class JourneyTest(unittest.TestCase):
    def setUp(self):
        self.exporter = InMemorySpanExporter()
        self.base = TracerProvider(resource=Resource.create({"service.name": "owlpane-sdk-python"}))
        self.base.add_span_processor(SimpleSpanProcessor(self.exporter))
        emit_journeys(self.base, 60, seed=7)
        self.spans = self.exporter.get_finished_spans()
        self.traces = defaultdict(list)
        for s in self.spans:
            self.traces[s.context.trace_id].append(s)

    def test_each_checkout_is_one_deep_multi_service_trace(self):
        self.assertEqual(len(self.traces), 60)
        for spans in self.traces.values():
            roots = [s for s in spans if s.parent is None]
            self.assertEqual([r.name for r in roots], ["POST /checkout"])
            ids = {s.context.span_id for s in spans}
            self.assertTrue(all(s.parent is None or s.parent.span_id in ids for s in spans), "every parent is in the trace")
            for s in spans:
                self.assertGreaterEqual(s.end_time, s.start_time)
        full = [s for s in self.traces.values() if not any(x.status.status_code.name == "ERROR" for x in s)]
        self.assertTrue(full)
        for spans in full:
            self.assertGreaterEqual(len(spans), 16)
            self.assertEqual({s.resource.attributes["service.name"] for s in spans}, {"owlpane-sdk-python", "dogfood-cart", "dogfood-inventory", "dogfood-payments", "dogfood-notify"})

    def test_slow_checkouts_mostly_use_one_provider_and_some_fail(self):
        roots = [s for s in self.spans if s.name == "POST /checkout"]
        slow = [r for r in roots if (r.end_time - r.start_time) / 1e6 > 500]
        self.assertTrue(slow)
        self.assertGreaterEqual(Counter(r.attributes["payment.provider"] for r in slow)["globex-pay"], len(slow) * 0.8)
        self.assertTrue(any(r.status.status_code.name == "ERROR" for r in roots))


if __name__ == "__main__":
    unittest.main()
