FROM eclipse-temurin:21-jdk-jammy@sha256:4b1a74fbffbe6b4e7b6f0171a472478282fb463790a51edf10e465d578f22b69
RUN apt-get update && apt-get install -y --no-install-recommends tini bash curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/java ./apps/java
COPY docker/app-k8s-entrypoint.sh /app-k8s-entrypoint.sh
RUN chmod +x /app-k8s-entrypoint.sh apps/java/run.sh \
  && cd apps/java && mkdir -p lib \
  && curl -fsSL -o lib/opentelemetry-javaagent.jar \
    "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.14.0/opentelemetry-javaagent.jar" \
  && echo "16f8e28fa1ddcd56ed85bf633bd1d1fbc78ea7c4cc50e8c5726b2a319f5058c8  lib/opentelemetry-javaagent.jar" | sha256sum -c -
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=java OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/app-k8s-entrypoint.sh"]
