import time
from opentelemetry import trace

tracer = trace.get_tracer("owlpane-example")
with tracer.start_as_current_span("hello-owlpane"):
    time.sleep(0.05)
print("span emitted")
