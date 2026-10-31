FROM ruby:3.3-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends tini bash build-essential procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/ruby ./apps/ruby
COPY docker/app-k8s-entrypoint.sh /app-k8s-entrypoint.sh
RUN chmod +x /app-k8s-entrypoint.sh apps/ruby/run.sh \
  && cd apps/ruby && bundle config set path vendor/bundle && bundle install --jobs 4
ENV OWLPANE_DOGFOOD_APP_ID=ruby OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/app-k8s-entrypoint.sh"]
