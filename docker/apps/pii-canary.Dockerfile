FROM node:22-bookworm
ARG SDK_VERSION=0.1.8
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY pii-canary/package.json ./pii-canary/
COPY pii-canary/src ./pii-canary/src
COPY pii-canary/run.sh ./pii-canary/
COPY docker/app-k8s-entrypoint.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh pii-canary/run.sh \
  && cd pii-canary \
  && npm pkg delete dependencies.@owlpane/node 2>/dev/null || true \
  && npm pkg set "dependencies.@owlpane/node=${SDK_VERSION}" \
  && npm install --no-audit --no-fund
ENV OWLPANE_DOGFOOD_APP_ID=pii-canary OWLPANE_EXAMPLE_MODE=server OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
