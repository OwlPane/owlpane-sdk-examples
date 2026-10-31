FROM eclipse-temurin:21-jdk-jammy
RUN apt-get update && apt-get install -y --no-install-recommends tini bash curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/java ./apps/java
COPY docker/app-k8s-entrypoint.sh /app-k8s-entrypoint.sh
RUN chmod +x /app-k8s-entrypoint.sh apps/java/run.sh \
  && cd apps/java && mkdir -p lib \
  && curl -fsSL -o lib/opentelemetry-javaagent.jar \
    "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.14.0/opentelemetry-javaagent.jar"
ENV OWLPANE_DOGFOOD_APP_ID=java OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/app-k8s-entrypoint.sh"]
