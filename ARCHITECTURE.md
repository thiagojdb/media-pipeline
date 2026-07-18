# Relay Architecture

Status: foundation architecture for the AI-first rebuild. Material changes should be explicit in this document or a later ADR.

## Goals

The architecture optimizes first for a working, understandable product that coding agents can change safely. Performance, infrastructure cost, and deployment scale are optimized after the central production loop works.

The foundation should provide:

- one primary language across product, agent integration, and rendering;
- few runtime boundaries with clear ownership;
- one video composition model for preview and final rendering;
- independently validated agent output;
- channel-scoped reusable components with immutable approved versions;
- deterministic tests that do not require model calls;
- explicit job, failure, retry, and budget state.

## Chosen stack

- **TypeScript** in strict mode across the repository
- **Next.js App Router** for the product application
- **Tailwind CSS and shadcn/ui** for the application interface
- **Convex** for application data, realtime state, and lightweight orchestration
- **Convex file storage initially** for uploaded inputs and generated outputs
- **Remotion** as the single composition, preview, and rendering model
- **Pi SDK** for component-authoring coding sessions
- **Node worker** for Pi sessions, component builds, and Remotion/FFmpeg work
- **Zod** for meaningful TypeScript runtime boundaries and component inputs

Use npm workspaces unless MED-130 discovers a concrete reason to choose another package manager.

## Repository shape

The intended minimal shape is:

```text
apps/
  web/                 Next.js creator application
  worker/              agent, build, and render job processor
packages/
  component-sdk/       public API available to video components
  component-testkit/   fixtures and deterministic validation
  rendering/           shared Remotion compositions and render entry points
convex/                 schema, queries, mutations, and actions
docs/                   later ADRs and operational notes
```

Do not create every directory before its issue needs it. This layout describes ownership, not a mandate for empty packages or abstraction layers.

## Runtime shape

```text
Browser
   |
   v
Next.js application <----> Convex
                              |
                              | durable job intent and realtime status
                              v
                        Node worker
                         |         |
                         |         +--> Remotion / FFmpeg render process
                         |
                         +--> Pi session controller
                                  |
                                  +--> constrained workspace tools
                                       and disposable build environment
```

### Next.js application

The web application owns creator-facing flows and server-rendered application pages. It does not compile arbitrary component code, run Pi, or render final video.

### Convex

Convex is the application control plane. It owns records such as:

- users, channels, and memberships;
- projects and later source/script/beat records;
- components and immutable component versions;
- component authoring requests and candidates;
- build and render jobs;
- approval decisions and review comments;
- asset metadata and file references.

Convex functions may validate commands, authorize access, update job state, and issue signed file access. They do not run long Remotion renders or arbitrary agent-generated code.

Use dedicated domain tables rather than a universal artifact table. Add version records only to concepts that require stable history, especially component source/builds, scripts, compositions, and renders.

### Node worker

The worker claims explicit jobs from Convex, heartbeats while running, and commits bounded progress and terminal results. It owns operations inappropriate for Next.js or Convex:

- Pi coding sessions;
- component workspace preparation;
- compilation and fixture verification;
- browser-based component checks;
- Remotion rendering and FFmpeg probing;
- cancellation and cleanup.

A worker crash must leave a job eligible for explicit recovery rather than falsely successful. Job handlers use idempotency keys or unique result slots where duplicate execution could publish two results.

## Pi integration

Relay should embed Pi through `@earendil-works/pi-coding-agent` rather than parsing terminal output. The SDK provides session lifecycle, event subscriptions, model runtime, resource loading, custom working directories, explicit tool selection, and persistent or in-memory session managers.

Each component creation or revision receives a fresh, bounded authoring run associated with a Relay job. Relay reconstructs authoritative context from:

- the public component SDK and test commands;
- channel design settings and selected assets;
- approved reference components;
- the selected component version for revisions;
- relevant compatibility and revision history;
- the user request and acceptance requirements.

Pi session logs may be retained as diagnostics and conversation history, but they are not the authority for component state. Source snapshots, validation results, and approved component versions are Relay records.

### Tool boundary

Pi’s default `bash`, `write`, and `edit` tools have normal host authority and are not a security sandbox. The product runner must not expose unrestricted built-ins to component-authoring sessions.

The runner should use a custom `ResourceLoader`, controlled system prompt, explicit `cwd`, and an allowlist of Relay-owned workspace tools, conceptually:

- list/read approved workspace files;
- write or edit files under the draft root;
- run an approved command inside the build environment;
- inspect validation evidence;
- declare a candidate ready for independent validation.

Path validation, process isolation, network policy, resource limits, and secret separation are enforced outside the model. Prompt instructions are not a security boundary.

### Bounded repair

When Pi stops, the platform validates the candidate independently. Structured failures may be sent back to the same active session for repair. The job freezes maximum attempts, model/tool turns, token or cost budget, command count, and wall time.

Budget exhaustion or repeated failure produces `needs_intervention`; it never starts an unlimited loop. A candidate cannot become reviewable without a successful independent validation record.

## Component model

A component has a stable channel-scoped identity. A component version is immutable and references exact source, build output, manifest, input schema, fixtures, validation evidence, and creation provenance.

At a high level the SDK supplies:

```ts
defineVideoComponent({
  id,
  schema,
  fixtures,
  duration,
  component,
});
```

MED-126 owns the exact API. The contract must expose deterministic frame state, dimensions, FPS, duration, validated inputs, channel theme, and resolved assets without ambient network or secrets.

Projects pin an exact component version. A revision creates a candidate successor; it never edits an approved version in place. Backward-incompatible input changes must be explicit because existing project instances retain their original version and inputs.

## Preview and rendering

Relay commits to Remotion for the rebuild. It does not recreate the alpha’s engine-neutral RenderPlan, Chromium-span classifier, Node/Java process protocol, or custom renderer abstraction.

The browser preview and worker render must evaluate the same Remotion component implementation with the same frame, FPS, dimensions, duration, assets, theme, and inputs. Editing overlays are separate and cannot affect rendered output.

Verified candidate previews should run in a sandboxed frame isolated from the main application. Final and draft rendering occurs in the worker environment. The first render path produces a resolution- and quality-pinned MP4 at 720p, 1080p, 1440p, or 4K from one exact component version. Programmatic graphics default to a near-lossless H.264 Master preset (CRF 1 with 4:4:4 chroma) because 4:2:0 subsampling damages thin colored edges and ordinary CRF values can introduce ringing around text. Compatible 4:2:0 and smaller-file presets remain explicit options; composition, audio, and broader codec options expand in later milestones. Higher resolutions remain explicit creator choices because they consume more worker time and memory. Local rendering favors machine responsiveness over throughput: one job and one Remotion frame worker run at a time, frame rendering and encoding do not overlap, H.264 uses a fast preset, and the worker lowers its OS scheduling priority where supported. MED-133 will replace the process-local queue with durable bounded jobs without weakening these resource controls.

MED-131 uses a process-local worker render registry and worker-owned `.relay/` output files to prove this path before durable orchestration exists. Next.js only proxies creator commands and downloads; it does not bundle or render. Progress and cancellation are explicit within the live worker process, while restart recovery, Convex job records, disposable workspaces, and untrusted candidate isolation remain MED-133 responsibilities.

Remotion is a deliberate product dependency. If measured licensing or scale requirements later justify replacement, migration is a future architecture project rather than complexity paid in advance.

## Storage

Convex file storage is sufficient for initial component sources, fixtures, preview evidence, and draft outputs. Domain records retain ownership, media type, size, and hashes where reproducibility requires them.

The system should not introduce an abstract storage framework during Foundation. If source footage or render volume later requires S3-compatible storage, migrate behind explicit asset access functions using measured requirements.

Secrets never enter component props, source bundles, job logs, browser responses, or render inputs. Provider credentials remain available only to the Pi model runtime/controller that needs them; generated component code and render processes do not receive them.

## Channel and authorization boundary

Every project, reusable component, asset, and production job belongs to a channel. Membership records exist from the initial schema even if the first development flow bootstraps one user and channel.

The identity provider and invitation interface are not selected by this foundation issue. Before external collaboration ships, authentication and every Convex operation must enforce membership and role checks. Avoid data shapes that would require converting owner-scoped records into channel-scoped records later.

## State models

### Component candidate

```text
draft
  -> agent_running
  -> validating
  -> reviewable
  -> approved

agent_running | validating
  -> failed
  -> retrying
  -> needs_intervention

reviewable
  -> changes_requested
  -> rejected
```

Approval creates an immutable component version. Failure never changes the prior approved version.

### Job

```text
queued -> running -> succeeded
                  -> failed
                  -> canceled
                  -> needs_intervention
```

Jobs record attempt count, bounded progress, timestamps, worker identity, and terminal error category. Stale heartbeats become recoverable state through an explicit policy implemented with the worker.

## Testing strategy

Normal tests and CI must not require a model provider or spend tokens.

- Unit tests cover schemas, time/frame calculations, policies, and state transitions.
- Integration tests use a fake agent that emits known valid and invalid component workspaces.
- Reference components provide deterministic fixtures and frame checkpoints.
- Browser tests cover creator-visible preview and recovery behavior on real routes.
- Render tests compare selected preview and output frames within declared tolerances.
- A real-Pi dogfood run is explicit, budgeted, and run only when the milestone calls for it.

The initial repository gate should remain small: format, lint, typecheck, unit tests, and production build. Add expensive gates only when they protect an implemented boundary.

## Deployment and trust stages

The first milestone targets local development and private dogfooding. Even locally, arbitrary generated code remains outside Next.js and Convex and cannot replace a working version without validation.

Before untrusted external users can author components, the worker boundary must additionally provide disposable containers or equivalent OS isolation, a read-only base, constrained writable workspace, network restrictions, non-root execution, CPU/memory/process/wall-time limits, and dependency policy. JavaScript sandbox libraries and model instructions alone are insufficient.

## Lessons retained from the alpha

The alpha established valuable product truths:

- sources, narration, visual intent, components, and review need to remain connected;
- channel-owned reusable visual capabilities are central;
- exact component versions and preserved source inputs make renders reproducible;
- background activity and failures need durable creator-visible state;
- agent writes should create reviewable drafts rather than overwrite approved work;
- preview/final agreement is a product requirement, not only a rendering test;
- selection and inspection should not destabilize the editing viewport.

It also demonstrated approaches the rebuild will not repeat initially:

- Java/Spring plus a separate Node renderer created a difficult cross-language surface for agent-led development;
- canonical JSON Schemas at every process boundary multiplied synchronized changes;
- a generic immutable artifact/dependency framework made ordinary product work indirect;
- JobRunr, an application-owned job model, and reconciliation introduced multiple lifecycle layers;
- engine neutrality required a custom compiler, span DAG, browser frame host, FFmpeg assembly, caching, and conformance system before the product worked;
- publication signatures, SBOMs, migration adapters, chaos suites, and broad provider routing arrived before the core user loop was dependable;
- a large suite and extensive documentation could report completion without proving routine real use;
- hidden prerequisites and local runtime dependencies allowed startup success while later rendering failed;
- broad generated implementations produced fragile interactions that needed repeated architectural repair.

The rebuild preserves the product knowledge, not the implementation momentum. `media-pipeline-alpha` is read-only reference material.

## Explicitly deferred architecture

Do not add these without a milestone and concrete requirement:

- Java or another backend application stack;
- a renderer-neutral persisted plan or renderer adapter interface;
- provider marketplace and fallback-routing matrix;
- component publication signatures or SBOMs;
- distributed queues, Kafka, Kubernetes, or render farms;
- universal artifact and dependency graph infrastructure;
- legacy migrations or compatibility readers;
- broad chaos, benchmark, and adversarial suites before their boundaries exist;
- a browser code editor as the default component workflow.
