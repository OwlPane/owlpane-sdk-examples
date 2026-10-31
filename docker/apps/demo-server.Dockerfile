FROM node:22-alpine
ARG SDK_VERSION=0.1.9
RUN apk add --no-cache tini bash
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY docker/app-k8s-entrypoint.sh docker/npm-install-published-node.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh /docker/npm-install-published-node.sh
COPY apps/demo-server/package.json ./apps/demo-server/
COPY apps/demo-server/src ./apps/demo-server/src
COPY apps/demo-server/run.sh ./apps/demo-server/
RUN chmod +x apps/demo-server/run.sh \
  && /docker/npm-install-published-node.sh "${SDK_VERSION}" apps/demo-server
ENV NODE_ENV=production \
    OWLPANE_DOGFOOD_APP_ID=demo-server \
    OWLPANE_EXAMPLE_MODE=server \
    OWLPANE_SDK_SOURCE=published \
    OWLPANE_METRICS_EXPORT_INTERVAL_MS=5000 \
    DEMO_INTERVAL_MS=3000 \
    DEMO_BIND_HOST=0.0.0.0 \
    DEMO_SERVER_PORT=4399
EXPOSE 4399
ENTRYPOINT ["/sbin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
