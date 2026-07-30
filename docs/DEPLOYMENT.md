# Relay environments and deployment

Relay uses promotion branches and fully separate environment credentials:

- `main` is the development branch.
- `prod` is the production branch.
- A production release is a reviewed promotion of an exact commit from
  `main`; production is never built from an uncommitted workspace.

## Development

Development is the complete alpha environment. It owns:

- the stable development Vercel project;
- the development Convex deployment and data;
- the persistent development worker on `brutus`;
- real-provider credentials used for private dogfooding;
- development-only worker and queue tokens.

The live stack formerly called production is now development. The persistent
worker remains on loopback port `3212`; local `npm run dev` uses `3213` so both
can run on `brutus` without sharing a process, credential, or workspace.

Pushes to `main` run model-free CI. A successful push starts
`Deploy development`, which:

1. deploys development Convex functions;
2. uploads, builds, and activates the exact development worker release;
3. rolls the worker back if its local health check fails;
4. builds and promotes the stable development Vercel deployment.

The GitHub `development` environment accepts only the `main` branch and must
contain:

- `CONVEX_DEPLOY_KEY` for the development Convex deployment;
- `VERCEL_TOKEN`;
- `VERCEL_ORG_ID`;
- `VERCEL_PROJECT_ID` for the development Vercel project.

`DEVELOPMENT_DEPLOY_ENABLED` remains `false` until the four credentials
formerly stored in the old production environment have been configured in the
development environment. The already-running development deployment remains
available during that credential transition.

The self-hosted runner is repository-scoped and carries the
`relay-development` label. It must never execute pull-request code.

### Persistent development worker

The tracked unit is
`deploy/systemd/relay-development-worker.service`. Its host-specific
environment is:

```text
~/.config/relay-worker/development.env
```

That file must be mode `0600`. The release root is:

```text
~/services/relay-development-worker
```

Install the unit and enable it:

```sh
install -Dm644 deploy/systemd/relay-development-worker.service \
  ~/.config/systemd/user/relay-development-worker.service
systemctl --user daemon-reload
systemctl --user enable --now relay-development-worker.service
```

Verify the development boundaries after deployment:

```sh
curl -fsS http://127.0.0.1:3212/health
curl -fsS https://relay-blush-sigma.vercel.app/api/component-loop/library
```

## Production

Production is a separate web and data environment owned by the `prod` branch.
During alpha it intentionally has **no worker**. Component authoring, model
script revision, narration alignment, and rendering therefore return an
explicit unavailable response in production instead of reaching the
development worker.

The production Vercel project must set:

- `RELAY_ENV=production`;
- its own `CONVEX_URL`;
- its own `NEXT_PUBLIC_CONVEX_URL`;
- its own `PROJECTS_CONVEX_URL`;
- its own `PROJECTS_SERVER_TOKEN`;
- no `RELAY_WORKER_URL`;
- no `RELAY_WORKER_AUTH_TOKEN`.

The production Convex deployment and all tokens must be distinct from
development. Production must never contain development project or channel
data.

The GitHub `production` environment accepts only the `prod` branch and must
contain production-scoped:

- `CONVEX_DEPLOY_KEY`;
- `VERCEL_TOKEN`;
- `VERCEL_ORG_ID`;
- `VERCEL_PROJECT_ID`.

`PRODUCTION_DEPLOY_ENABLED` is an environment variable, not a secret. It
defaults to `false`. Keep it disabled until the separate Vercel project,
Convex deployment, and four production secrets are configured and verified.

Once enabled, a successful CI push to `prod` deploys only:

1. production Convex functions;
2. the production Vercel application.

It does not package, start, or contact a worker.

## Promotion

Normal work lands on `main` and deploys to development. Promote to production
by opening a pull request from `main` to `prod`. CI must pass on the exact
candidate commit. Merging that pull request advances `prod`; it does not copy
development data or credentials.

Before enabling automatic production deployment:

1. Verify the production Vercel project has no worker URL or token.
2. Verify its Convex URL differs from development.
3. Verify the production GitHub secrets target only the new production
   resources.
4. Confirm worker-backed routes return `503 worker_unavailable`.
5. Set `PRODUCTION_DEPLOY_ENABLED=true`.

## Trust boundary

Generated component code and video rendering never execute in Next.js or
Convex. Development retains the private dogfood worker until production worker
is explicitly justified. Adding a production worker later requires a separate
service, credentials, queue tokens, storage roots, monitoring, and release
approval; it must not reuse the development worker.
