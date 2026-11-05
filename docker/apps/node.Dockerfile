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
COPY apps/node/package.json apps/node/package-lock.json* ./apps/node/
COPY apps/node/src ./apps/node/src
COPY apps/node/run.sh ./apps/node/
RUN SDK_V="$(/docker/resolve-sdk-version.sh)" \
  && chmod +x apps/node/run.sh \
  && /docker/npm-install-published-node.sh "${SDK_V}" apps/node
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=node OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/sbin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
