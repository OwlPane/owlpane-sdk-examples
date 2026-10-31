import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;

// Compiled without any OpenTelemetry dependency wiring beyond the API: the -javaagent installs the SDK
// and exporter from OTEL_* environment variables. Here one span is created by hand so the sample
// is deterministic; real apps get spans for HTTP, JDBC, etc. automatically.
public class App {
  public static void main(String[] args) throws Exception {
    var tracer = GlobalOpenTelemetry.getTracer("owlpane-example");
    Span server = tracer.spanBuilder("GET /demo").setSpanKind(SpanKind.SERVER).startSpan();
    Thread.sleep(30);
    server.end();
    Span span = tracer.spanBuilder("hello-owlpane").startSpan();
    Thread.sleep(20);
    span.end();
    System.out.println("span emitted");
  }
}
