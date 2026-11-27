# Local End-to-End Integration Test Harness

Run and verify every local-capable Owlpane integration with **zero external cloud accounts**.

## 1. Start the local services + OTel Collector + Mailpit + Grafana

```bash
export OWLPANE_INGEST_URL=http://host.docker.internal:4318
export OWLPANE_INGEST_KEY=owl_ing_your_project_key
export OWLPANE_API_URL=http://host.docker.internal:4100
export OWLPANE_TOKEN=owl_pat_or_owl_sa_token

docker compose -f integrations-test/docker-compose.yml up -d
```

Services started:
- **PostgreSQL 17** (`15432`), **MySQL 8.4** (`13306`), **MongoDB 7** (`17017`), **Redis 7** (`16379`)
- **Kafka 3.8 KRaft** (`19092`), **RabbitMQ 3** (`15672`), **NGINX** (`18080`, `/stub_status` enabled)
- **OpenTelemetry Collector Contrib** scraping all 7 services and forwarding to `OWLPANE_INGEST_URL`
- **Mailpit SMTP** (`1025`, Web UI at `http://localhost:8025`) — set `OWLPANE_SMTP_URL=smtp://127.0.0.1:1025` on `api`
- **Grafana 11** (`http://localhost:13000`, pre-provisioned with Owlpane Prometheus `POST` data source)

## 2. Run the automated verification script

```bash
OWLPANE_INGEST_URL=http://127.0.0.1:4318 \
OWLPANE_INGEST_KEY=owl_ing_your_project_key \
OWLPANE_API_URL=http://127.0.0.1:4100 \
OWLPANE_TOKEN=owl_pat_or_owl_sa_token \
node integrations-test/test-all-integrations.mjs
```

## 3. Teardown

```bash
docker compose -f integrations-test/docker-compose.yml down -v
```
