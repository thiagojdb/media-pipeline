# Environment contract

| Concern              | Development                                | Production                            |
| -------------------- | ------------------------------------------ | ------------------------------------- |
| Branch               | `main`                                     | `prod`                                |
| Purpose              | Complete alpha and private dogfooding      | Stable user-facing web/data boundary  |
| Web                  | Existing stable Vercel project             | Separate Vercel project               |
| Data                 | Development Convex deployment              | Separate production Convex deployment |
| Worker               | Persistent worker on `brutus:3212`         | None during alpha                     |
| Model/render actions | Enabled when development credentials exist | Explicitly unavailable                |
| Deployment           | Disabled during credential migration       | Disabled until explicitly activated   |
| Promotion            | Direct work and review                     | Pull request from `main` to `prod`    |

## Invariants

1. A web deployment may communicate only with resources from its own
   environment.
2. Development and production never share Convex deployments, data, server
   tokens, provider keys, or storage roots.
3. `RELAY_WORKER_URL` is mandatory when worker-backed features are enabled.
   There is no implicit worker URL.
4. Production alpha omits the worker URL and token. Worker-backed routes return
   `503 worker_unavailable`.
5. Only an exact CI-verified commit may be promoted from `main` to `prod`.
6. The production workflow cannot run while
   `PRODUCTION_DEPLOY_ENABLED=false`.
7. Local development uses local Convex, worker port `3213`, and a fixed
   development-only worker token; it cannot fall through to the persistent
   worker on `3212`.

## Current transition

The Vercel, Convex, and persistent worker resources previously called
production are the development environment. Their GitHub credentials must be
moved from the old `production` environment into the new `development`
environment. `DEVELOPMENT_DEPLOY_ENABLED=false` prevents a failed or
misdirected release until that migration is complete.

The `prod` branch initially preserves the last deployed commit. It does not
have a live production deployment until separate production Vercel and Convex
resources are configured. There is intentionally no production worker.
