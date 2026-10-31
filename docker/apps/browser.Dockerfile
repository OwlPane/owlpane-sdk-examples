FROM node:22-bookworm
ARG SDK_VERSION=0.1.8
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/browser/package.json apps/browser/package-lock.json* ./apps/browser/
COPY apps/browser/src ./apps/browser/src
COPY apps/browser/run.sh ./apps/browser/
COPY docker/app-k8s-entrypoint.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh apps/browser/run.sh \
  && cd apps/browser \
  && npm pkg delete dependencies.@owlpane/browser 2>/dev/null || true \
  && rm -f package-lock.json \
  && npm pkg set "dependencies.@owlpane/browser=${SDK_VERSION}" \
  && npm install --no-audit --no-fund \
  && npm install tsx@^4.20.6 typescript@^5.9.3 --no-audit --no-fund
ENV OWLPANE_DOGFOOD_APP_ID=browser OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
