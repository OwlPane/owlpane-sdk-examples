FROM python:3.12-slim-bookworm
ARG SDK_VERSION=0.1.8
RUN apt-get update && apt-get install -y --no-install-recommends tini bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY _lib ./_lib
COPY dogfood.manifest.json ./
COPY apps/python/app.py apps/python/run.sh ./apps/python/
COPY apps/python/requirements-published.txt ./apps/python/
COPY docker/app-k8s-entrypoint.sh /docker/
RUN chmod +x /docker/app-k8s-entrypoint.sh apps/python/run.sh \
  && cd apps/python \
  && sed -i "s/^owlpane==.*/owlpane==${SDK_VERSION}/" requirements-published.txt \
  && python3 -m venv .venv \
  && .venv/bin/pip install --no-cache-dir -r requirements-published.txt
ENV OWLPANE_DOGFOOD_APP_ID=python OWLPANE_EXAMPLE_MODE=loop OWLPANE_SDK_SOURCE=published
ENTRYPOINT ["/usr/bin/tini", "--", "/docker/app-k8s-entrypoint.sh"]
