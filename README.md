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

Workspace package builds are ordered explicitly, so `npm run build` and the `npm run dev` preparation step do not depend on ignored `dist` output from an earlier run.

### Browser tests

Install the pinned Playwright Chromium runtime once after `npm install`:

```bash
npx playwright install chromium
```

Then run the browser suite deterministically against test-owned production web and fake-render worker processes:

```bash
npm run test:browser
```

The command first performs the production build, starts the worker on `127.0.0.1:3213` and `next start` on `127.0.0.1:3100`, and refuses to reuse processes already listening there. Browser tests use an explicitly selected fake renderer; they still exercise the real browser → Next.js proxy → worker HTTP path without invoking Chromium or FFmpeg. Browser tests remain explicit rather than part of `npm run verify`. Playwright reports, traces, render outputs, and test-result directories are ignored build artifacts.

### Draft render smoke test

Run the explicit Remotion/Chromium/FFmpeg proof with:

```bash
npm run render:smoke
```

It renders the reference line chart twice at 960×540, verifies both outputs as playable H.264 MP4s, and proves declared checkpoint agreement across the browser preview, Remotion stills, and frames decoded from the MP4. It also confirms identical requests produce identical Remotion checkpoint fingerprints. This expensive proof is separate from the normal repository gate.

## MED-129 trust boundary

The component preview registry is a closed allowlist of trusted reference definitions bundled with this application. Exact component id and version lookup has no fallback. MED-129 does not load or execute agent-generated candidates and does not claim to provide a sandbox. Candidate workspaces, process isolation, and untrusted-code execution belong to MED-133.

## Workspace boundaries

- `apps/web` — Next.js App Router creator application with Tailwind CSS and shadcn/ui
- `apps/worker` — Node process boundary for future Pi, component-build, and render jobs
- `convex` — durable application data and lightweight orchestration
- `packages/component-sdk` — public component contract boundary (defined by MED-126)
- `packages/component-testkit` — deterministic component validation boundary
- `packages/rendering` — shared Remotion composition and rendering integration

The worker exposes health and process-local MP4 render endpoints with explicit 720p, 1080p, 1440p, and 4K choices. Quality presets range from Master graphics (CRF 1, 4:4:4 chroma) to Compact (CRF 28, 4:2:0 chroma). Master graphics is the creator default because 4:2:0 chroma subsampling visibly damages thin colored edges and CRF 18 can still introduce ringing around text on dark programmatic graphics. Compatible and Compact remain available for older playback hardware and smaller files. The worker owns Remotion bundling, rendering, progress, cancellation, and output files under `.relay/`. To keep the development machine responsive, render jobs are serialized, Remotion uses one frame worker, encoding does not overlap frame rendering, H.264 uses the `veryfast` preset, and the real worker lowers its OS scheduling priority. Higher resolutions still take longer and use more memory. These render records deliberately do not survive worker restart; durable job claiming, recovery, and isolated candidate workspaces belong to MED-133. Pi execution belongs to MED-128.

## Foundation documents

- [`PRODUCT.md`](PRODUCT.md) — users, product model, and target workflow
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — technical boundaries and decisions
- [`MILESTONES.md`](MILESTONES.md) — delivery order and acceptance gates
- [`AGENTS.md`](AGENTS.md) — instructions for coding agents

## Legacy boundary

`../media-pipeline-alpha` and the archived Linear project **Legacy — Visual Composition and Component Platform** are read-only research sources. Do not copy legacy code, contracts, or architecture unless a new issue explicitly justifies the choice.
