# Published SDK version for examples

**Registry truth:** npm / PyPI ship on **`sdk-v*`** releases from the private **[owlpane-sdk](https://github.com/OwlPane/owlpane-sdk)** repo (`Publish SDK` workflow).

## Single pin (no scattered semver in source)

| Source | Used by |
|--------|---------|
| **`sdk-published.version`** (repo root) | Default for local runs, `docker build`, and CI |
| **`OWLPANE_SDK_VERSION`** in `.env` | Optional override for local dogfood / `run.sh` |
| **`SDK_VERSION` Docker build-arg** | CI (`publish-sdk-example-images`) and explicit `docker build --build-arg` |

Resolution order: env override → pin file → (Docker only) `SDK_VERSION` arg via `docker/resolve-sdk-version.sh`.

Helpers:

- `_lib/sdk-version.sh` — `read_sdk_published_version` for shell apps
- `scripts/sync-pinned-sdk-version.sh 0.1.10` — update the pin file only

After a new SDK release:

1. Run `./scripts/sync-pinned-sdk-version.sh <semver>` (or edit **`sdk-published.version`**) and push **`main`**.
2. **Publish SDK example images** runs automatically (`.github/workflows/publish-sdk-example-images.yml`), or trigger from **owlpane-sdk** after `sdk-v*` (needs **`SDK_EXAMPLES_DISPATCH_TOKEN`**) — waits for npm/PyPI, then builds GHCR **`sdk-example-*`** images.
3. If GHCR push fails with `permission_denied: read_package`, see [ghcr-publish-troubleshooting.md](./ghcr-publish-troubleshooting.md) (org package ACL + optional **`GHCR_PUSH_TOKEN`**).

Local dev uses published npm/PyPI only (no monorepo `file:` links in this repo).

`package.json` uses `"*"` for `@owlpane/*`; install scripts set the exact version from **`OWLPANE_SDK_VERSION`**. Telemetry `release` / `service.version` comes from **`OWLPANE_SERVICE_VERSION`** (defaults to the same pin).
