# GHCR publish troubleshooting (`sdk-example-*`)

Workflow: [`.github/workflows/publish-sdk-example-images.yml`](../.github/workflows/publish-sdk-example-images.yml).

Images: `ghcr.io/owlpane/sdk-example-<id>:<tag>` (owner = lowercase `GITHUB_REPOSITORY_OWNER`).

## Symptom

Build succeeds, **push** fails:

```text
denied: permission_denied: read_package
```

Docker/buildx is trying to push to an **org package** the workflow token cannot read/update.

## Root cause (fixed in CI layout)

GHCR container packages **`sdk-example-*`** are **linked to `OwlPane/owlpane-sdk`**, not this repo. Pushes from **owlpane-sdk-examples** fail with `permission_denied: read_package`.

**Canonical publish workflow:** [`OwlPane/owlpane-sdk`](https://github.com/OwlPane/owlpane-sdk) → **Publish SDK example images** (checks out this repo and pushes with the SDK repo token).

This repo’s workflow **delegates** via `SDK_PUBLISH_DISPATCH_TOKEN` (PAT with `workflow` on **owlpane-sdk**) or you can run manually:

```bash
gh workflow run publish-sdk-example-images.yml -R OwlPane/owlpane-sdk \
  -f sdk_version=0.1.9 -f wait_for_registries=true -f examples_ref=main
```

Optional org admin steps (only if you want to re-link packages to this repo instead):

1. **Actions workflow permissions** — org **Read and write** for workflows.
2. **Package settings** — grant **owlpane-sdk-examples** write on each `sdk-example-*` package.
3. **Optional `GHCR_PUSH_TOKEN`** on this repo if packages stay SDK-linked but you push from here anyway.

## Re-run after fix

```bash
gh workflow run publish-sdk-example-images.yml -R OwlPane/owlpane-sdk-examples \
  -f sdk_version=0.1.9 -f wait_for_registries=true
```

Or wait for **`repository_dispatch`** `sdk-published` from **owlpane-sdk** (requires **`SDK_EXAMPLES_DISPATCH_TOKEN`** on the SDK repo).

## GitOps `imageTag`

When secret **`GIT_TOKEN`** can push **`balaji-singh/seo-infra`**, the workflow updates  
`helm-charts/owlpane-sdk-examples/values-hetzner.yaml`. Without it, bump **`imageTag`** manually after a green publish.
