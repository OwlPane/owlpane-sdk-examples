ARG APP_ID=rust
ARG SDK_VERSION
FROM node:22-bookworm@sha256:18a6d90fd60542269850c80ca03b29b1d9b14d6b221ac7ee8e35b0d33ef904bd
ARG APP_ID
ARG SDK_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app
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
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=${APP_ID} OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
