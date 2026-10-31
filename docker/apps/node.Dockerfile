FROM node:22-alpine
ARG SDK_VERSION=0.1.9
RUN apk add --no-cache tini bash
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY docker/app-k8s-entrypoint.sh docker/npm-install-published-node.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh /docker/npm-install-published-node.sh
COPY apps/node/package.json apps/node/package-lock.json* ./apps/node/
COPY apps/node/src ./apps/node/src
COPY apps/node/run.sh ./apps/node/
RUN chmod +x apps/node/run.sh \
  && /docker/npm-install-published-node.sh "${SDK_VERSION}" apps/node
ENV OWLPANE_DOGFOOD_APP_ID=node OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/sbin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
