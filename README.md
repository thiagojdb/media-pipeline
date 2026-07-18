# Relay

Relay is an AI-assisted production workspace for scripted, source-based YouTube channels.

The rebuild starts with the riskiest product loop: a creator asks a coding agent to build a reusable channel video component, Relay validates it independently, the creator reviews it at arbitrary frames, and the exact approved version renders into video.

## Local development

Requirements:

- Node.js 24 or newer
- npm 11 or newer

A Convex account is not required for local development. Use an account only when you intentionally choose a hosted Convex deployment.

Install dependencies, then start the complete local development environment:

```bash
npm install
npm run dev
```

`npm run dev` is the single start path. It runs the Next.js application, Convex development service, and Node worker together. On the first run, the Convex CLI configures a local development deployment and writes `.env.local`; later runs reuse that configuration. Choose a hosted project only when you explicitly want cloud development.

Local endpoints are:

- web application: <http://localhost:3000>
- Convex API: <http://127.0.0.1:3210> when using the default local deployment
- worker health: <http://127.0.0.1:3212/health>

Copy `.env.example` only when you need to set values manually. Never commit `.env.local` or credentials.

## Verification

Run the clean-checkout gate with:

```bash
npm run verify
```

The gate checks formatting, lint, strict TypeScript, deterministic unit tests, package builds, and the Next.js production build. It does not call a model provider.

Individual commands are also available:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Workspace boundaries

- `apps/web` — Next.js App Router creator application with Tailwind CSS and shadcn/ui
- `apps/worker` — Node process boundary for future Pi, component-build, and render jobs
- `convex` — durable application data and lightweight orchestration
- `packages/component-sdk` — public component contract boundary (defined by MED-126)
- `packages/component-testkit` — deterministic component validation boundary
- `packages/rendering` — shared Remotion composition and rendering integration

The worker currently exposes only a health endpoint. Job claiming, agent execution, component contracts, and rendering workflows belong to later scoped issues.

## Foundation documents

- [`PRODUCT.md`](PRODUCT.md) — users, product model, and target workflow
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — technical boundaries and decisions
- [`MILESTONES.md`](MILESTONES.md) — delivery order and acceptance gates
- [`AGENTS.md`](AGENTS.md) — instructions for coding agents

## Legacy boundary

`../media-pipeline-alpha` and the archived Linear project **Legacy — Visual Composition and Component Platform** are read-only research sources. Do not copy legacy code, contracts, or architecture unless a new issue explicitly justifies the choice.
