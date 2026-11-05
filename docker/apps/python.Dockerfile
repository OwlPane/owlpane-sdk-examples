FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG SDK_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app
WORKDIR /app
COPY sdk-published.version ./sdk-published.version
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/python/app.py apps/python/run.sh ./apps/python/
COPY apps/python/requirements-published.txt ./apps/python/
COPY docker/app-k8s-entrypoint.sh docker/resolve-sdk-version.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh /docker/resolve-sdk-version.sh apps/python/run.sh \
  && SDK_V="$(/docker/resolve-sdk-version.sh)" \
  && cd apps/python \
  && printf 'owlpane==%s\n' "${SDK_V}" > requirements-published.txt \
  && python3 -m venv .venv \
  && .venv/bin/pip install --no-cache-dir -r requirements-published.txt
# Run as an unprivileged user; the entrypoint writes only under /app and $HOME.
RUN chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/app
ENV OWLPANE_DOGFOOD_APP_ID=python OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
