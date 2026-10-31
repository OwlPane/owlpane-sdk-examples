# SDK example container images (k3s)

One **image per** `dogfood.manifest.json` app. Argo CD app **`owlpane-sdk-examples`** (seo-infra) deploys one Deployment each.

| App id | Dockerfile |
|--------|------------|
| node, go, python, java, ruby, browser, demo-server, pii-canary | `apps/<id>.Dockerfile` |
| rust, php, dotnet, react-native, serverless | `apps/emitter.Dockerfile` + `APP_ID` |

Build context is always the **`owlpane/sdk` repo root**. CI: `.github/workflows/publish-sdk-examples.yml`.
