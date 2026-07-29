# Production deployment

Relay uses two production runtimes because generated component code and video
rendering must not execute inside Next.js:

- Vercel hosts `apps/web` and forwards authenticated worker requests.
- Convex stores durable application, component, and render state.
- A persistent Linux host runs `apps/worker` with Bubblewrap, Chromium, and
  FFmpeg. The worker is exposed through HTTPS and requires
  `RELAY_WORKER_AUTH_TOKEN` for every operation; `/health` remains
  unauthenticated for monitoring.

## Vercel

The repository root is the Vercel project root. `vercel.json` builds shared
packages before the Next.js workspace. Production requires:

- `CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_URL`
- `PROJECTS_CONVEX_URL`
- `PROJECTS_SERVER_TOKEN`
- `RELAY_WORKER_URL`
- `RELAY_WORKER_AUTH_TOKEN`

The worker URL must be an HTTPS endpoint reachable from Vercel. Never expose a
worker without the matching auth token.

## Convex

Production worker loops require matching server-only values in Convex and the
worker environment:

- `COMPONENT_BUILD_WORKER_TOKEN`
- `AUTHORING_WORKER_TOKEN`
- `COMPONENT_LOOP_WORKER_TOKEN`
- `NARRATION_WORKER_TOKEN`

`PROJECTS_SERVER_TOKEN` remains the separate Next.js-to-Convex credential.

## Persistent worker

Install the tracked user unit from
`deploy/systemd/relay-worker.service`, place the production environment at
`~/.config/relay-worker/production.env` with mode `0600`, and enable the unit:

```sh
systemctl --user daemon-reload
systemctl --user enable --now relay-worker.service
```

The production host must have Node.js, npm, Bubblewrap, Chromium, and FFmpeg.
User lingering keeps the worker running without an interactive login. Verify
both boundaries after deployment:

```sh
curl -fsS http://127.0.0.1:3212/health
curl -fsS https://relay-blush-sigma.vercel.app/api/component-loop/library
```

The worker uses authenticated Convex query subscriptions to wake its enabled
job queues. Healthy idle operation does not repeatedly invoke queue `claim` or
`recoverExpired` mutations. Deploy Convex functions before a worker release
that changes the subscription or lease-recovery contract. After restarting the
worker, submit one job for each enabled queue, then confirm in Convex Usage that
function calls stop increasing continuously once the queues are empty.

Real Pi authoring remains fail-closed. Enable it only with an explicitly
selected model and a server-only provider credential. Deterministic fake mode
is suitable for deployment smoke tests and does not spend model tokens.

## GitHub Actions

Pull requests to `main` and pushes to `main` run the model-free `CI / verify`
check. A successful `main` push then starts the serialized
`Deploy production` workflow:

1. Deploy Convex functions.
2. Upload, build, and activate an exact worker release.
3. Roll the worker back if its local health check does not pass.
4. Build and promote the Vercel production deployment.

Create a GitHub environment named `production`. Configure these environment
secrets:

- `CONVEX_DEPLOY_KEY`: a production-scoped Convex deploy key.
- `VERCEL_TOKEN`: a Vercel access token that can deploy the Relay project.
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`: the linked Vercel project IDs.

The production job targets a self-hosted runner with the
`relay-production` label on the persistent worker host. Do not assign this
label to a general-purpose runner, and do not run pull-request workflows on
it. The runner account needs permission to write `~/services/relay-worker`,
run the tracked user service, and read the existing
`~/.config/relay-worker/production.env`. Before the first automated release:

```sh
mkdir -p ~/services/relay-worker/releases
install -Dm644 deploy/systemd/relay-worker.service \
  ~/.config/systemd/user/relay-worker.service
systemctl --user daemon-reload
systemctl --user enable relay-worker.service
```

Install the GitHub runner with the repository-scoped registration token, the
name `brutus-relay`, and the labels `self-hosted,Linux,X64,relay-production`.
Then install and enable the tracked
`deploy/systemd/github-relay-runner.service` user unit. Keep this runner
repository-scoped so unrelated repositories cannot schedule work on the
production host.

If the Vercel project is still connected directly to GitHub, disable its
automatic production deployment for `main`; GitHub Actions is the production
release authority. Preview deployments may remain enabled for pull requests.

The production GitHub environment is the approval boundary for releases. Add
required reviewers there if production should require a manual approval after
`main` passes CI. Do not add provider credentials to GitHub's repository-wide
variables or workflow files.
