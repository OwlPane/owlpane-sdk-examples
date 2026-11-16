FROM golang:1.23-bookworm@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db
ARG SDK_VERSION
ENV GOTOOLCHAIN=auto
ENV GOPROXY=https://proxy.golang.org,direct
ENV GOPRIVATE=github.com/OwlPane/*
# Fresh submodule tags may lag sum.golang.org; fetch from GitHub when needed.
ENV GONOSUMDB=github.com/OwlPane/owlpane-sdk
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app
WORKDIR /app
COPY sdk-published.version ./sdk-published.version
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/go ./apps/go
COPY docker/app-k8s-entrypoint.sh docker/resolve-sdk-version.sh /docker/
RUN --mount=type=secret,id=GITHUB_TOKEN,required=false \
  chmod +x /docker/app-k8s-entrypoint.sh /docker/resolve-sdk-version.sh apps/go/run.sh \
  && if [ -f /run/secrets/GITHUB_TOKEN ]; then \
       git config --global url."https://x-access-token:$(cat /run/secrets/GITHUB_TOKEN)@github.com/".insteadOf "https://github.com/"; \
     fi \
  && SDK_V="$(/docker/resolve-sdk-version.sh)" \
  && cd apps/go \
  && sed -i '/^replace /d' go.mod \
  && go mod edit -require=github.com/OwlPane/owlpane-sdk/packages/go@v${SDK_V} \
  && go mod tidy \
  && go mod download
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app /go
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=go OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
