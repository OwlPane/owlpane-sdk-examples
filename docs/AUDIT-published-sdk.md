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

1. ~~**Publish SDK `sdk-v0.1.9`**~~ — **done** (npm `@owlpane/node` / `@owlpane/browser`, PyPI `owlpane==0.1.9`, tag [`sdk-v0.1.9`](https://github.com/OwlPane/owlpane-sdk/releases/tag/sdk-v0.1.9); CI fix: vend `examples/_receiver` for conformance).
2. **`sdk/examples/`** legacy tree on **owlpane-sdk** — dogfood source of truth is **owlpane-sdk-examples** only; trim SDK repo when ready.
3. **seo-infra** `helm-charts/owlpane-sdk-examples/values-hetzner.yaml` **`imageTag`** updates via examples CI when **`GIT_TOKEN`** is set.
4. **`SDK_EXAMPLES_DISPATCH_TOKEN`** on owlpane-sdk for automatic example image builds after publish (optional; manual `workflow_dispatch` works).

## Verify

```bash
npm view @owlpane/node@0.1.9 version
grep nodeSdkVersion owlpane/api/release-pins/pins.json owlpane/console/release-pins/pins.json
cat owlpane/owlpane-sdk-examples/sdk-published.version
```
