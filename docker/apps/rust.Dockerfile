# Compiled like the Go example: sdk-published.version is in the image, so the
# chart does not need to inject OWLPANE_SDK_VERSION (Java and Ruby do).
FROM rust:1.88-bookworm AS build
WORKDIR /src
COPY apps/rust/Cargo.toml apps/rust/Cargo.lock ./
COPY apps/rust/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini bash ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY sdk-published.version ./sdk-published.version
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/rust/run.sh ./apps/rust/run.sh
COPY --from=build /src/target/release/owlpane-dogfood-rust ./apps/rust/target/release/owlpane-dogfood-rust
COPY docker/app-k8s-entrypoint.sh /docker/app-k8s-entrypoint.sh
RUN chmod +x /docker/app-k8s-entrypoint.sh apps/rust/run.sh apps/rust/target/release/owlpane-dogfood-rust
ENV OWLPANE_DOGFOOD_APP_ID=rust OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
