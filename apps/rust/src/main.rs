//! One OTLP log, one server span, and one metric per process.
//! The container entrypoint repeats this on `DOGFOOD_INTERVAL_SEC`.
//!
//! Wire format matches the Go example: OTLP HTTP protobuf to
//! `{OTEL_EXPORTER_OTLP_ENDPOINT|/OWLPANE_INGEST_URL}/v1/{traces,metrics,logs}`
//! with `Authorization: Bearer <OWLPANE_INGEST_KEY>` when a key is set.

use opentelemetry::logs::{AnyValue, LogRecord, Logger, LoggerProvider, Severity};
use opentelemetry::metrics::MeterProvider;
use opentelemetry::trace::{Span, SpanKind, Tracer, TracerProvider};
use opentelemetry::KeyValue;
use opentelemetry_otlp::{LogExporter, MetricExporter, Protocol, SpanExporter};
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use std::collections::HashMap;
use std::error::Error;

fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    let service = env_or("OTEL_SERVICE_NAME", "owlpane-sdk-rust");
    let base = otlp_base()?;
    let headers = auth_headers();

    let resource = Resource::builder()
        .with_service_name(service.clone())
        .build();

    let span_exporter = SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(format!("{base}/v1/traces"))
        .with_headers(headers.clone())
        .build()?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_simple_exporter(span_exporter)
        .build();

    let metric_exporter = MetricExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(format!("{base}/v1/metrics"))
        .with_headers(headers.clone())
        .build()?;
    let meter_provider = SdkMeterProvider::builder()
        .with_resource(resource.clone())
        .with_periodic_exporter(metric_exporter)
        .build();

    let log_exporter = LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(format!("{base}/v1/logs"))
        .with_headers(headers)
        .build()?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_simple_exporter(log_exporter)
        .build();

    emit_span(&tracer_provider);
    emit_metric(&meter_provider);
    emit_log(&logger_provider, &service);

    // Shutdown flushes the one-shot exporters. A second force_flush would
    // POST the same metric again.
    meter_provider.shutdown()?;
    logger_provider.shutdown()?;
    tracer_provider.shutdown()?;

    println!("emitted 1 log, 1 span, 1 metric ({service})");
    Ok(())
}

fn emit_span(provider: &SdkTracerProvider) {
    let tracer = provider.tracer("owlpane-dogfood");
    let mut span = tracer
        .span_builder("GET /demo")
        .with_kind(SpanKind::Server)
        .with_attributes([
            KeyValue::new("http.request.method", "GET"),
            KeyValue::new("http.route", "/demo"),
            KeyValue::new("http.response.status_code", 200_i64),
        ])
        .start(&tracer);
    span.end();
}

fn emit_metric(provider: &SdkMeterProvider) {
    let meter = provider.meter("owlpane-dogfood");
    let counter = meter.u64_counter("owlpane.dogfood.heartbeat").build();
    counter.add(1, &[KeyValue::new("owlpane.dogfood", "true")]);
}

fn emit_log(provider: &SdkLoggerProvider, service: &str) {
    let logger = provider.logger("owlpane-dogfood");
    let mut record = logger.create_log_record();
    record.set_severity_number(Severity::Info);
    record.set_severity_text("INFO");
    record.set_body(AnyValue::from(format!("dogfood log heartbeat ({service})")));
    record.add_attribute("owlpane.dogfood", "true");
    logger.emit(record);
}

fn otlp_base() -> Result<String, Box<dyn Error + Send + Sync>> {
    let raw = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .or_else(|_| std::env::var("OWLPANE_INGEST_URL"))
        .unwrap_or_default();
    let base = raw.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err(
            "set OTEL_EXPORTER_OTLP_ENDPOINT or OWLPANE_INGEST_URL (no ingest key is read from git)"
                .into(),
        );
    }
    Ok(base)
}

/// Same header the Go SDK sets: `Authorization: Bearer <OWLPANE_INGEST_KEY>`.
fn auth_headers() -> HashMap<String, String> {
    let mut headers = HashMap::new();
    let key = std::env::var("OWLPANE_INGEST_KEY").unwrap_or_default();
    let key = key.trim();
    if !key.is_empty() {
        headers.insert("Authorization".to_string(), format!("Bearer {key}"));
    }
    headers
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}
