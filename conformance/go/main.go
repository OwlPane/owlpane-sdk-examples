package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func main() {
	ctx := context.Background()
	// otlptracehttp reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS / _PROTOCOL from the environment.
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		log.Fatal(err)
	}
	// resource.WithFromEnv reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES.
	res, err := resource.New(ctx, resource.WithFromEnv(), resource.WithTelemetrySDK())
	if err != nil {
		log.Fatal(err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)

	_, span := otel.Tracer("owlpane-example").Start(ctx, "hello-owlpane")
	time.Sleep(50 * time.Millisecond)
	span.End()

	// Flush before exit; short-lived programs lose spans otherwise.
	if err := tp.Shutdown(ctx); err != nil {
		log.Fatal(err)
	}
	fmt.Println("span emitted")
}
