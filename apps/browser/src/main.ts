import { init } from "@owlpane/browser";

const endpoint =
  process.env.OWLPANE_INGEST_URL ??
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
  "http://127.0.0.1:4318";
const projectKey = process.env.OWLPANE_INGEST_KEY ?? "";
const serviceName = process.env.OTEL_SERVICE_NAME ?? "owlpane-sdk-browser";
const environment = process.env.OWLPANE_ENVIRONMENT ?? "development";

if (!projectKey) {
  console.error("Missing OWLPANE_INGEST_KEY — check examples/.env");
  process.exit(1);
}

const listeners = new Map<string, Array<() => void>>();
const startMs = Date.now();

const rum = init({
  endpoint,
  projectKey,
  serviceName,
  environment,
  release: process.env.OWLPANE_SERVICE_VERSION ?? process.env.OWLPANE_SDK_VERSION,
  env: {
    now: () => Date.now(),
    performance: {
      timeOrigin: startMs,
      now: () => Date.now() - startMs,
      getEntriesByType: (type: string) =>
        type === "navigation"
          ? [
              {
                fetchStart: 2,
                domainLookupStart: 4,
                domainLookupEnd: 10,
                connectStart: 10,
                connectEnd: 22,
                requestStart: 24,
                responseStart: 58,
                responseEnd: 85,
                domInteractive: 120,
                domContentLoadedEventEnd: 145,
                loadEventEnd: 190,
                transferSize: 24576,
              },
            ]
          : [],
    },
    location: {
      href: `${(process.env.OWLPANE_CONSOLE_URL ?? "http://127.0.0.1:4200").replace(/\/+$/, "")}/checkout?utm_source=test`,
      origin: (process.env.OWLPANE_CONSOLE_URL ?? "http://127.0.0.1:4200").replace(/\/+$/, ""),
      pathname: "/checkout",
    },
    document: {
      readyState: "complete",
      visibilityState: "visible",
    },
    navigator: {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) OwlpaneDogfood/1.0",
    },
    addEventListener: (event: string, cb: () => void) => {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    },
    fetch: globalThis.fetch.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  },
});

rum.setFeatureFlag("checkout-redesign", "treatment-b");
rum.setExperiment("exp-cart-2026", "variant-a");

for (const cb of listeners.get("load") ?? []) {
  cb();
}

if (process.env.OWLPANE_DOGFOOD_MODE === "rich") {
  rum.captureException(new TypeError("Cannot read properties of null (reading 'cardToken')"));
}

await rum.flush();
await rum.shutdown();
console.log(`browser RUM spans emitted (${serviceName})`);
