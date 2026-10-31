ARG APP_ID=rust
ARG SDK_VERSION
FROM node:22-bookworm
ARG APP_ID
ARG SDK_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY sdk-published.version ./sdk-published.version
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY docker/app-k8s-entrypoint.sh docker/npm-install-published-node.sh docker/resolve-sdk-version.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh /docker/npm-install-published-node.sh /docker/resolve-sdk-version.sh
COPY apps/node/package.json ./apps/node/
COPY apps/${APP_ID} ./apps/${APP_ID}/
RUN SDK_V="$(/docker/resolve-sdk-version.sh)" \
  && chmod +x apps/${APP_ID}/run.sh \
  && /docker/npm-install-published-node.sh "${SDK_V}" apps/node
ENV OWLPANE_DOGFOOD_APP_ID=${APP_ID} OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
