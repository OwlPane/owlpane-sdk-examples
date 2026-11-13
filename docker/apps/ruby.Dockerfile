FROM ruby:3.3-slim-bookworm@sha256:245eafdd393b298a1bcc6948504b59a117539d46a7fd12ebb8bd2c103f814566
RUN apt-get update && apt-get install -y --no-install-recommends tini bash build-essential procps && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/ruby ./apps/ruby
COPY docker/app-k8s-entrypoint.sh /app-k8s-entrypoint.sh
RUN chmod +x /app-k8s-entrypoint.sh apps/ruby/run.sh \
  && cd apps/ruby && bundle config set path vendor/bundle && bundle install --jobs 4
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=ruby OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/app-k8s-entrypoint.sh"]
