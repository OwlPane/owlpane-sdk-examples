FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ARG SDK_VERSION
RUN apk add --no-cache tini bash
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app -h /home/app app
WORKDIR /app
COPY sdk-published.version ./sdk-published.version
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY docker/app-k8s-entrypoint.sh docker/npm-install-published-node.sh docker/resolve-sdk-version.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh /docker/npm-install-published-node.sh /docker/resolve-sdk-version.sh
COPY apps/demo-server/package.json ./apps/demo-server/
COPY apps/demo-server/src ./apps/demo-server/src
COPY apps/demo-server/run.sh ./apps/demo-server/
RUN SDK_V="$(/docker/resolve-sdk-version.sh)" \
  && chmod +x apps/demo-server/run.sh \
  && /docker/npm-install-published-node.sh "${SDK_V}" apps/demo-server
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
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
