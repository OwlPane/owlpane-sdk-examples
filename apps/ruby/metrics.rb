# frozen_string_literal: true

require "opentelemetry-metrics-sdk"
require "opentelemetry/exporter/otlp_metrics"

# OTLP process + Ruby runtime gauges for Observability → Runtimes (Ruby tab).
def setup_dogfood_metrics!(endpoint:, headers:)
  resource = OpenTelemetry.tracer_provider.resource
  exporter = OpenTelemetry::Exporter::OTLP::Metrics::MetricsExporter.new(
    endpoint: "#{endpoint.chomp('/')}/v1/metrics",
    headers: headers,
  )
  reader = OpenTelemetry::SDK::Metrics::Export::PeriodicMetricReader.new(
    export_interval_millis: 5_000,
    exporter: exporter,
  )
  provider = OpenTelemetry::SDK::Metrics::MeterProvider.new(resource: resource)
  provider.add_metric_reader(reader)
  OpenTelemetry.meter_provider = provider

  meter = provider.meter("owlpane-dogfood")

  meter.create_observable_gauge(
    "process.runtime.ruby.thread_count",
    callback: proc { Thread.list.size },
    unit: "{thread}",
    description: "Live Ruby threads",
  )

  meter.create_observable_gauge(
    "process.runtime.ruby.gc.count",
    callback: proc do
      c = GC.count
      c.is_a?(Array) ? c.sum : c.to_i
    end,
    unit: "{run}",
    description: "GC runs since process start",
  )

  meter.create_observable_gauge(
    "process.runtime.ruby.heap.use",
    callback: proc { GC.stat[:heap_live_slots] || 0 },
    unit: "{slot}",
    description: "Live heap slots (GC.stat heap_live_slots)",
  )

  meter.create_observable_gauge(
    "process.memory.usage",
    callback: proc { `ps -o rss= -p #{Process.pid}`.strip.to_i * 1024 },
    unit: "By",
    description: "Process RSS bytes (best-effort)",
  )

  meter.create_observable_gauge(
    "process.cpu.utilization",
    callback: proc { 0.01 },
    unit: "1",
    description: "Placeholder CPU ratio for dogfood charts",
  )
end

def flush_dogfood_metrics!(seconds: 8)
  provider = OpenTelemetry.meter_provider
  return unless provider

  sleep(seconds)
  provider.shutdown if provider.respond_to?(:shutdown)
end
