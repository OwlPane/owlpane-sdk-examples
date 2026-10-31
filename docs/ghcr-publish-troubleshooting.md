# GHCR publish troubleshooting (`sdk-example-*`)

Workflow: [`.github/workflows/publish-sdk-example-images.yml`](../.github/workflows/publish-sdk-example-images.yml).

Images: `ghcr.io/owlpane/sdk-example-<id>:<tag>` (owner = lowercase `GITHUB_REPOSITORY_OWNER`).

## Symptom

Build succeeds, **push** fails:

```text
denied: permission_denied: read_package
```

Docker/buildx is trying to push to an **org package** the workflow token cannot read/update.

## Fix (org admin — OwlPane)

1. **Actions workflow permissions**  
   GitHub → **OwlPane** org → **Settings** → **Actions** → **General** → **Workflow permissions** → **Read and write permissions** (not read-only).

2. **Link packages to this repo**  
   For each `sdk-example-*` package (or before first successful push):  
   **Packages** → package → **Package settings** → **Manage Actions access** → add **`OwlPane/owlpane-sdk-examples`** with **Write** (or inherit from repo if org policy allows).

3. **Existing packages owned by another repo/user**  
   If packages were created under a different repository, either:
   - Grant **owlpane-sdk-examples** write access on the package (step 2), or
   - Delete stale empty packages and re-run the workflow so GHCR recreates them under the publishing repo.

4. **Optional PAT (recommended for org-wide GHCR)**  
   Create a fine-grained PAT or classic token with **`write:packages`** (and **`read:packages`**) on the org.  
   Add repo secret **`GHCR_PUSH_TOKEN`**. The workflow prefers this over `GITHUB_TOKEN` when set.

## Re-run after fix

```bash
gh workflow run publish-sdk-example-images.yml -R OwlPane/owlpane-sdk-examples \
  -f sdk_version=0.1.9 -f wait_for_registries=true
```

Or wait for **`repository_dispatch`** `sdk-published` from **owlpane-sdk** (requires **`SDK_EXAMPLES_DISPATCH_TOKEN`** on the SDK repo).

## GitOps `imageTag`

When secret **`GIT_TOKEN`** can push **`balaji-singh/seo-infra`**, the workflow updates  
`helm-charts/owlpane-sdk-examples/values-hetzner.yaml`. Without it, bump **`imageTag`** manually after a green publish.
