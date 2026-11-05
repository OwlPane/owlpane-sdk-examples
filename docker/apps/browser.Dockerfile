FROM node:22-bookworm@sha256:18a6d90fd60542269850c80ca03b29b1d9b14d6b221ac7ee8e35b0d33ef904bd
ARG SDK_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app
WORKDIR /app
COPY sdk-published.version ./sdk-published.version
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/browser/package.json apps/browser/package-lock.json* ./apps/browser/
COPY apps/browser/src ./apps/browser/src
COPY apps/browser/run.sh ./apps/browser/
COPY docker/app-k8s-entrypoint.sh docker/resolve-sdk-version.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh /docker/resolve-sdk-version.sh apps/browser/run.sh \
  && SDK_V="$(/docker/resolve-sdk-version.sh)" \
  && cd apps/browser \
  && npm pkg delete dependencies.@owlpane/browser 2>/dev/null || true \
  && rm -f package-lock.json \
  && npm pkg set "dependencies.@owlpane/browser=${SDK_V}" \
  && npm install --no-audit --no-fund \
  && npm install tsx@4.23.15 typescript@5.9.3 --no-audit --no-fund
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=browser OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
