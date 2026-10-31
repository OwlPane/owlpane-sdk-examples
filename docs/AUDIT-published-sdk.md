# Audit: published SDK (0.1.9) — Oct 2026

## Single sources of truth

| Concern | Location |
|---------|----------|
| Example apps + GHCR images | **OwlPane/owlpane-sdk-examples** (`sdk-published.version`, `OWLPANE_SDK_VERSION`, Docker `SDK_VERSION`) |
| Customer install semver in Console/API | **`api/release-pins/pins.json`** + **`console/release-pins/pins.json`** (`nodeSdkVersion`) — keep identical |
| npm/PyPI/browser packages | **OwlPane/owlpane-sdk** tag **`sdk-v*`** → Publish SDK workflow |
| Generated install snippets | **`owlpane-sdk/schema/install-snippets.json`** (from `npm run codegen`) |

## Repo hygiene (this audit)

- Removed stale **`sdk/examples`** path references → **`owlpane-sdk-examples`** across API docs/scripts, SDK docs, Console vendor docs, examples README/scripts.
- Bumped **`nodeSdkVersion`** to **0.1.9** in API + Console pins (align with `sdk-published.version` after npm publish).
- Dynamic version in examples: no scattered semver in Dockerfiles/`package.json`; see [published-sdk-version.md](./published-sdk-version.md).

## Still on maintainers

1. **Publish SDK `sdk-v0.1.9`** must finish before npm/PyPI and example Docker builds succeed.
2. **`sdk/examples/`** tree may still exist on older **owlpane-sdk** branches — dogfood source of truth is the **public examples repo** only; delete legacy tree on SDK `main` when ready.
3. **seo-infra** `helm-charts/owlpane-sdk-examples/values-hetzner.yaml` **`imageTag`** updates via examples CI when **`GIT_TOKEN`** is set.
4. **`SDK_EXAMPLES_DISPATCH_TOKEN`** on owlpane-sdk for automatic example image builds after publish.

## Verify

```bash
npm view @owlpane/node@0.1.9 version
grep nodeSdkVersion owlpane/api/release-pins/pins.json owlpane/console/release-pins/pins.json
cat owlpane/owlpane-sdk-examples/sdk-published.version
```
