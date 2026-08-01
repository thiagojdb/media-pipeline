# Parallel local development cells

Relay uses a development cell when more than one worktree needs to run at the
same time. A cell is one local web process, one local worker, one set of local
build/render directories, and one Rementor hostname.

```text
relay-alice.localhost:18080  -> Rementor -> Next.js on 127.0.0.1:<web-port>
relay-bob.localhost:18080    -> Rementor -> Next.js on 127.0.0.1:<web-port>
                                  |
                                  +-> that cell's worker on 127.0.0.1:<worker-port>
```

Rementor is the browser-facing routing layer. It does not provision Convex,
start processes, or isolate data. The cell launcher owns those local process
and filesystem boundaries.

## One-time setup

Rementor must be running locally. Check it with:

```bash
rementorctl --json workspace list
```

The repository's setup creates a `relay-local` Rementor workspace of type
`local-apps` with the local domain `relay.localhost`. The launcher also creates
that workspace idempotently if it is missing.

On this machine Rementor's standalone nginx listens on `127.0.0.1:18080`, so
cell URLs include `:18080`. If the Rementor proxy is configured on another
port, set `REMENTOR_PROXY_PORT` before starting the cell.

The launcher requires the same server-only Convex values as the normal local
stack. Put them in the existing machine-local development environment or in a
gitignored `.env.local`:

```dotenv
PROJECTS_CONVEX_URL=...
PROJECTS_SERVER_TOKEN=...
```

All other Relay Convex worker URLs and tokens should refer to the same
development deployment unless you intentionally configure a separate cell
deployment.

## Starting a cell

Create a worktree first, then run the cell from that worktree:

```bash
git worktree add ../media-pipeline-wt/med-157 -b agent/med-157 main
cd ../media-pipeline-wt/med-157
npm install
npm run dev:cell -- med-157
```

The cell always starts the configured provider-backed stack. Once the web
server responds, the launcher registers and activates an app named
`relay-med-157` in Rementor and prints the URL:

```text
http://relay-med-157.localhost:18080
```

The cell receives a deterministic web/worker port pair derived from its id.
Use explicit ports when a collision is reported:

```bash
npm run dev:cell -- med-157 --web-port 3407 --worker-port 5407
```

This command does not create a new Convex deployment. If the cell must not
share data, queues, or file storage with other cells, supply a separate set of
Convex URLs and server tokens in that worktree's environment before starting
it. The default hosted development deployment is shared infrastructure.

## What the launcher isolates

Each cell sets:

- `PORT` and `RELAY_WEB_PORT` for Next.js;
- `RELAY_LOCAL_WORKER_PORT` and a unique worker auth token;
- `RELAY_WORKER_URL` to that cell's loopback worker;
- `RELAY_INSTANCE_ID` and `RELAY_DEV_HOSTNAME`;
- `NEXT_DIST_DIR` for Next's development output (by default
  `.next-dev-<instance-id>`);
- `RELAY_INSTANCE_ROOT` for renders, component builds, authoring sessions,
  Pi sessions, and narration temporary files;
- a unique development user subject and channel slug by default.

The worker health response includes `instanceId` when running inside a cell.
Use it to verify that a browser route and worker belong to the same cell.

Rementor only handles the web route. The web application calls the worker
directly over loopback, so the worker does not need its own Rementor hostname.

## Stopping and recovering routes

Press `Ctrl-C` in the cell terminal. The launcher stops the child stack and
unregisters its Rementor app. If the terminal was killed or the process crashed,
remove the stale route explicitly:

```bash
npm run dev:cell -- cleanup med-157
```

This removes only `relay-med-157` from `relay-local`; it does not delete the
worktree or any Convex data.

Inspect the routing state with:

```bash
rementorctl --json workspace list
rementorctl --json app list relay-local
```

Do not use `workspace set all` or change the GISS `desenvolvimento` and
`qualidade` workspaces for Relay work. The Relay launcher owns only the
`relay-local` workspace and `relay-*` application ids.

## Browser and integration testing

Use the Rementor hostname, not the direct port, when testing the browser path:

```bash
curl -I http://relay-med-157.localhost:18080/projects
```

The hostname gives each cell an independent browser cookie origin. Direct
`127.0.0.1:<port>` access is useful for debugging the Next process itself.

When a request appears to work but the local code does not log it, test both
addresses. A successful Rementor response may be coming from a stale or remote
route; confirm the local process receives the request before treating the test
as evidence.

## Data and side-effect safety

Separate hostnames do not imply separate Convex data. The default cell setup
uses the configured development deployment, so multiple cells can still see
the same projects and durable jobs. Use a dedicated Convex deployment per cell
for full data and queue isolation. If a shared deployment is intentional,
keep the cell in its own development channel and configure provider credentials
only in the worker environment.

Every cell can spend model tokens, create external provider traffic, and mutate
shared development data. Never put provider credentials in browser variables,
component source, or Rementor configuration.

## Troubleshooting

### Rementor is unavailable

```bash
rementorctl --json workspace list
```

Start or repair the local Rementor service before starting a routed cell. For
process-only work, use the direct port only after passing `--domain` through a
different local proxy.

### The port is already in use

The launcher fails before starting the stack. Pick a free pair with
`--web-port` and `--worker-port`; do not stop an unrelated process just to
reuse the deterministic pair.

### The route is stale

```bash
npm run dev:cell -- cleanup med-157
rementorctl --json app list relay-local
```

Then start the cell again. The launcher registers the route only after the
local web process is reachable.

### The browser sees the wrong data

Check `PROJECTS_CONVEX_URL`, the server token, and the worker-specific Convex
variables in the cell environment. Rementor cannot correct a web process that
is pointed at the wrong deployment.
