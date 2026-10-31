# Published SDK version for examples

**Registry truth:** npm / PyPI ship on **`sdk-v*`** releases from the private **[owlpane-sdk](https://github.com/OwlPane/owlpane-sdk)** repo (`Publish SDK` workflow).

**Pin for Docker / `OWLPANE_SDK_SOURCE=published`:**

```text
sdk-published.version   → 0.1.8
```

After a new SDK release:

1. Set **`sdk-published.version`** to the released version and push **`main`** here.
2. **Publish SDK example images** runs automatically (`.github/workflows/publish-sdk-example-images.yml`).
3. Or trigger from **owlpane-sdk** after `sdk-v*` (needs **`SDK_EXAMPLES_DISPATCH_TOKEN`** on the SDK repo) — waits for npm/PyPI, then builds GHCR **`sdk-example-*`** images.

Local dev uses published npm/PyPI only (no monorepo `file:` links in this repo).
