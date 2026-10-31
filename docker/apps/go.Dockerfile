FROM golang:1.23-bookworm
ARG SDK_VERSION=0.1.9
ENV GOTOOLCHAIN=auto
ENV GOPROXY=https://proxy.golang.org,direct
# Fresh submodule tags may lag sum.golang.org; fetch from GitHub when needed.
ENV GONOSUMDB=sum.golang.org
ENV GONOSUMDB=github.com/OwlPane/owlpane-sdk
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/go ./apps/go
COPY docker/app-k8s-entrypoint.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh apps/go/run.sh \
  && cd apps/go \
  && sed -i '/^replace /d' go.mod \
  && go mod edit -require=github.com/OwlPane/owlpane-sdk/packages/go@v${SDK_VERSION} \
  && go mod tidy \
  && go mod download
ENV OWLPANE_DOGFOOD_APP_ID=go OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
