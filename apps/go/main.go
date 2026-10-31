package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/OwlPane/owlpane-sdk/packages/go/owlpane"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	ctx := context.Background()
	shutdown, err := owlpane.Start(ctx, nil)
	if err != nil {
		log.Fatal(err)
	}
	if shutdown == nil {
		log.Fatal("owlpane did not start — check examples/.env")
	}

	rich := os.Getenv("OWLPANE_DOGFOOD_MODE") == "rich"
	tr := otel.Tracer("owlpane-dogfood")

	reqCtx, span := tr.Start(ctx, "GET /demo",
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(
			attribute.String("http.request.method", "GET"),
			attribute.String("http.route", "/demo"),
			attribute.Int("http.response.status_code", 200),
		),
	)
	time.Sleep(25 * time.Millisecond)
	if rich {
		_, dbSpan := tr.Start(reqCtx, "SELECT orders",
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(
				attribute.String("db.system", "postgresql"),
				attribute.String("db.operation.name", "SELECT"),
			),
		)
		time.Sleep(10 * time.Millisecond)
		dbSpan.End()
	}
	span.End()

	if rich {
		_, workerSpan := tr.Start(ctx, "POST /internal/worker",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				attribute.String("http.request.method", "POST"),
				attribute.String("http.route", "/internal/worker"),
				attribute.String("messaging.system", "sqs"),
				attribute.String("messaging.destination.name", "dogfood-jobs"),
			),
		)
		time.Sleep(8 * time.Millisecond)
		workerSpan.End()

		_, errSpan := tr.Start(ctx, "POST /checkout",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				attribute.String("http.request.method", "POST"),
				attribute.String("http.route", "/checkout"),
				attribute.Int("http.response.status_code", 500),
			),
		)
		checkoutErr := errors.New("upstream ledger connection refused")
		errSpan.RecordError(checkoutErr)
		errSpan.SetStatus(codes.Error, checkoutErr.Error())
		errSpan.End()
	}

	if sec := getenv("OWLPANE_DOGFOOD_METRICS_SLEEP_SEC", "6"); sec != "0" {
		if d, err := time.ParseDuration(sec + "s"); err == nil && d > 0 {
			time.Sleep(d)
		}
	}

	if err := shutdown(ctx); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("span emitted (%s)\n", mustService())
}

func mustService() string {
	return getenv("OTEL_SERVICE_NAME", "owlpane-sdk-go")
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
