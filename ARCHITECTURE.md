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
- explicit job, failure, retry, usage, and operational-limit state.

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

Each component creation or revision is a durable phase of the same Relay agent session, associated with an explicit Relay job. Relay reconstructs authoritative implementation context from:

- the public component SDK and test commands;
- channel design settings and selected assets;
- approved reference components;
- the selected component version for revisions;
- relevant compatibility and revision history;
- the user request and acceptance requirements.

Pi session logs may be retained as diagnostics and conversation history, but they are not the authority for component state. Source snapshots, validation results, and approved component versions are Relay records.

Convex remains authoritative for the creator-visible thread, including messages, activity, candidates, approved versions, and the thread theme. The browser persists only the opaque thread identifier in the URL and local storage so reloads and direct links can reconstruct that state. Clearing the browser pointer starts a new chat; it does not delete the durable thread.

The channel component library is a read model over `components` and immutable `componentVersions`; reviewable or failed candidates never become reusable library entries. Each approved version resolves through its validated build to the originating thread. Starting a fresh revision conversation stores an exact selected base-version reference on the new durable conversation thread. Dialogue can begin without loading source, while the implementation transition resolves that pinned version into the existing exact-source revision boundary. Opening the original thread and starting a fresh revision are therefore distinct, explicit operations.

### Conversational handoff boundary

MED-137 places a durable dialogue phase before component authoring. MED-138 makes that dialogue, research, implementation, revision, and review one durable Relay/Pi session rather than a planner-to-implementor handoff. The base session receives a compact system prompt, a small skill catalog, controlled reference-research tools, authoritative work-state inspection, and `begin_component_implementation`. It has no component source, SDK pack, shell, or authoring tools until the explicit transition. Text deltas are persisted and streamed to the creator; model reasoning is never exposed, while coarse statuses such as thinking, responding, skill loading, compaction, and tool activity may be shown in a collapsed activity surface.

A greeting or ambiguous request stays in dialogue and can produce ordinary conversation, controlled web research, or clarifying questions without creating an authoring turn. Skills are on-demand instruction packs, never permissions. When the model has an actionable request, it first tells the creator that implementation is starting and invokes the build transition with a self-contained brief. Only that transition allows the worker to construct the expensive authoritative context and expose Relay-owned source/check/declaration tools in the same provider session. Status questions inspect durable work state and cannot silently enqueue duplicate work.

Pi automatic compaction remains enabled with a response reserve and recent-message retention. Relay persists compaction lifecycle metadata but never exposes the generated summary or hidden reasoning. The UI distinguishes active context (`used / model context window`) from lifetime processed input, output, cached input, and estimated cost. Model-turn, token, and cost counters are telemetry rather than creative-work terminal conditions. Explicit cancellation, provider errors, and an infrastructure-stall watchdog remain recoverable operational boundaries; process isolation and independent validation limits remain security boundaries.

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

When Pi stops, the platform validates the candidate independently. Structured failures may be sent back to the same active session for repair. Provider usage remains observable rather than limiting creative work. Explicit cancellation, provider failure, repeated invalid output, or an infrastructure stall can produce a recoverable interruption; a candidate cannot become reviewable without a successful independent validation record.

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

Verified candidate previews should run in a sandboxed frame isolated from the main application. Final and draft rendering occurs in the worker environment. The first render path produces a resolution- and quality-pinned MP4 at 720p, 1080p, 1440p, or 4K from one exact component version. Programmatic graphics default to a near-lossless H.264 Master preset (CRF 1 with 4:4:4 chroma) because 4:2:0 subsampling damages thin colored edges and ordinary CRF values can introduce ringing around text. Compatible 4:2:0 and smaller-file presets remain explicit options; composition, audio, and broader codec options expand in later milestones. Higher resolutions remain explicit creator choices because they consume more worker time and memory. Local rendering favors machine responsiveness over throughput: one job and one Remotion frame worker run at a time, frame rendering and encoding do not overlap, H.264 uses a fast preset, and the worker lowers its OS scheduling priority where supported.

For component review, the worker compiles the exact independently validated source snapshot into a browser bundle without executing it. Next.js proxies that opaque response into a script-only sandboxed iframe with a restrictive content-security policy. Read-only source inspection uses the same candidate snapshot and hash. Generated modules are never imported into the Next.js or Convex runtime, and approved-version preview resolves the immutable build snapshot pinned at approval.

MED-131 retains a process-local worker render registry and worker-owned `.relay/` output files. Next.js only proxies creator commands and downloads; it does not bundle or render. MED-133 adds durable Convex orchestration, restart recovery, and isolation for component-build jobs specifically; render-job durability remains deferred rather than being hidden behind a premature generic job framework.

Remotion is a deliberate product dependency. If measured licensing or scale requirements later justify replacement, migration is a future architecture project rather than complexity paid in advance.

## Storage

Convex file storage is sufficient for initial component sources, fixtures, preview evidence, and draft outputs. Domain records retain ownership, media type, size, and hashes where reproducibility requires them.

MED-143 applies that rule to project evidence. Browser files upload directly through a short-lived Convex upload URL, then a channel-authorized mutation validates the stored media type and byte size before publishing a source record with its storage hash. URL sources are canonicalized, reject embedded credentials and secret-like query parameters, and retain a reference hash. Removing either kind is a soft domain transition so failed revisions and future derived records cannot lose their provenance; rejected or failed uploads are never published as project sources. Next.js adapters return only allowlisted domain errors so backend details and the development server token cannot cross into browser responses.

The system should not introduce an abstract storage framework during Foundation. If source footage or render volume later requires S3-compatible storage, migrate behind explicit asset access functions using measured requirements.

Secrets never enter component props, source bundles, job logs, browser responses, or render inputs. Provider credentials remain available only to the Pi model runtime/controller that needs them; generated component code and render processes do not receive them.

## Channel and authorization boundary

Every project, reusable component, asset, and production job belongs to a channel. Membership records exist from the initial schema even if the first development flow bootstraps one user and channel.

The identity provider and invitation interface are not selected by this foundation issue. Before external collaboration ships, authentication and every Convex operation must enforce membership and role checks. Avoid data shapes that would require converting owner-scoped records into channel-scoped records later.

MED-142 establishes the private-development form of this boundary. Convex stores users, channels, memberships, and channel-scoped projects; every project query and mutation resolves a server-supplied development identity to an explicit membership before reading or changing data. A Next.js server adapter holds the dedicated project token and bootstraps the single development user and channel, so the browser cannot select or spoof either identity. This bootstrap is not the future external-auth design; a later identity provider replaces the server-supplied subject while retaining the same membership-backed records and authorization checks.

MED-144 stores project scripts as append-only `scriptVersions` with monotonic project-local numbers, exact unmodified content, provenance, creator membership, and creation time. The project holds an explicit pointer and number for the current version; no mutation edits an existing version. Historical versions have stable project/version routes, while list responses expose bounded summaries rather than duplicating every full script into the browser.

MED-145 adds durable narration jobs with leases, attempt fencing, heartbeat recovery, creator cancellation, and visible terminal states. A successful worker claim pins one exact immutable script version, generates or receives timestamped audio outside Next.js and Convex, uploads it to Convex storage, then atomically publishes an immutable narration version with duration, timing segments, provider/model identity, usage, cost, and wall-time telemetry. Normal development and CI use a deterministic WAV-generating fake provider with zero external calls; the provider boundary can be replaced without changing narration records or job authority.

MED-146 extends that same immutable version boundary to uploaded narration. The browser uploads directly to Convex storage after a server-authorized prepare step; a durable worker then probes the stored file with FFprobe and publishes its exact duration, codec, sample rate, channel count, and source filename. Replacements advance the project narration pointer without changing earlier versions, so compositions can continue to reference the exact audio version they were built against.

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

Jobs record attempt count, bounded progress, timestamps, worker identity, and terminal error category. Stale heartbeats become recoverable state through an explicit policy implemented with the worker. Convex server time defines lease expiry, and each claim attempt is a fencing token: an expired process cannot heartbeat or publish after a successor claim, even if it reused the same worker identifier.

### Component-build execution boundary

Component builds are durable Convex records with explicit queued, running, validating, failed, needs-intervention, succeeded, and canceled states. Leases and heartbeats recover abandoned work within a bounded retry budget. Final candidate publication rechecks cancellation transactionally. Jobs carry opaque channel/thread/turn lineage plus exact source hashes and optional parent/base references, allowing later chat-like turns without MED-133 implementing messages or Pi. Enqueue is idempotent per channel/thread/turn. Safe internal queries expose ordered thread jobs and bounded events without returning source, logs, lease ownership, or worker credentials.

The Node worker is the only candidate execution host. It removes abandoned local workspaces at startup, creates a disposable allowlisted workspace, rejects traversal, symlinks, undeclared dependencies, and file/byte excesses, then invokes one fixed validator command under Bubblewrap and `prlimit`. Isolation is fail-closed and adversarial smoke probes verify blocked network, hidden host homes/repository, cleared parent environment, read-only candidate workspace, and namespace-contained root writes. Worker mutations require a server-only token and enqueue remains internal; there is no unauthenticated web mutation surface. Health reports `running`, `degraded`, `stopped`, or `disabled` from the live control loop rather than configuration alone.

The first implementation keeps successful candidates as immutable content-addressed references rather than durable object-storage artifacts. Durable artifact storage, Pi commands, independent repair, approval, and chat UI remain later issue scope.

### Component-authoring agent boundary

MED-128 adds durable authoring threads and turns above MED-133 jobs. Each turn pins the exact base source/hash, optional parent candidate and base snapshot, user request, acceptance criteria, channel theme and non-secret asset metadata, and relevant prior summaries. Enqueue binds every immutable input and is idempotent per channel/thread/turn; leases use server time and attempt fencing. Provider token/cost accounting is persisted as telemetry, with cached usage reported separately. Per-response output remains bounded to prevent malformed unbounded responses, but accumulated model-turn/token/cost counters do not terminate useful work. A candidate submission atomically creates or reuses one MED-133 validation job and means only `candidate_submitted`, never validated or approved.

Relay constructs a deterministic, size-bounded, hashed context pack from the public SDK, reference component, fixtures, exact base, theme/assets metadata, prior summaries, and explicit dependency/tool policy. Context construction rejects source hash mismatch, symlinks, traversal, oversized files, malformed JSON, and credential-like fields. A disposable authoring workspace exposes the context read-only and only candidate source as writable.

Pi receives no built-in filesystem or shell tools. During implementation, the only source-authority tools are Relay-owned operations to read context, replace complete candidate source, check syntax/source policy without executing candidate code, and declare a checked candidate ready. Relay's own focused skills and controlled research tools are discovered on demand in the conversational phase; global/project extensions, prompt templates, themes, and context files remain disabled. Settings are in memory, and a single server-injected API-key or OAuth credential is parsed into an app-owned in-memory credential store; ModelRuntime is never allowed to fall back to Pi's global auth file. Credentials never enter sessions, context, logs, or workspaces. The model is exact, automatic compaction is enabled, and session files are constrained to a Relay-owned root. Convex messages, work state, and exact component records remain authoritative when a session file cannot be resumed.

MED-123 makes validation evidence, rather than the readiness declaration, the next authority boundary. The worker independently repeats source policy, bundles TypeScript against only the declared SDK dependencies, loads the public component contract, validates fixtures, renders every checkpoint twice for deterministic behavior, and evaluates every fixture frame at the smallest supported dimensions. Candidate execution remains inside the MED-133 Bubblewrap/prlimit boundary. Each terminal build retains bounded structured evidence and a full-frame render fingerprint. A validation failure atomically queues a successor authoring turn with the exact failed source, the same opaque Pi session reference, and structured evidence. Usage accumulates as telemetry instead of shrinking a repair allowance. A successful build creates only a content-addressed candidate reference and never replaces an approved version.

MED-125 promotes a successful build only to a `reviewable` component candidate containing its declared identity/version, input-schema fingerprint, fixtures, dimensions, exact source lineage, and validation evidence. Approval is a separate explicit creator decision that creates one immutable component-version record; rejection and changes requested leave the latest approved version untouched. Schema changes from the exact selected base produce an acknowledgement-required compatibility warning. Revision turns reconstruct their base source and hash from that selected immutable version, while project component pins continue to reference an exact version until explicitly changed. Approved history retains the build/source reference required for later preview and rendering instead of copying or mutating source in place.

Normal CI and development use the deterministic fake agent and never initialize a model runtime. Real Pi is dynamically loaded only in explicit real mode with an exact model and server-only credential. MED-123 owns independent repair, MED-125 owns review/approval, and MED-124 owns the creator chat-like end-to-end proof.

## Testing strategy

Normal tests and CI must not require a model provider or spend tokens.

- Unit tests cover schemas, time/frame calculations, policies, and state transitions.
- Integration tests use a fake agent that emits known valid and invalid component workspaces.
- Reference components provide deterministic fixtures and frame checkpoints.
- Browser tests cover creator-visible preview and recovery behavior on real routes.
- Render tests compare selected preview and output frames within declared tolerances.
- A real-Pi dogfood run is explicit, records usage and estimated cost, and runs only when the milestone calls for it.

The initial repository gate should remain small: format, lint, typecheck, unit tests, and production build. Add expensive gates only when they protect an implemented boundary.

## Deployment and trust stages

The first milestone targets local development and private dogfooding. Even locally, arbitrary generated code remains outside Next.js and Convex and cannot replace a working version without validation.

MED-133 establishes the local Linux proof with disposable workspaces, Bubblewrap namespaces, a read-only base, no network or home access, and `prlimit` CPU/memory/process/file/wall-time bounds. JavaScript sandbox libraries and model instructions alone remain insufficient. Before untrusted external users or deployment beyond private dogfooding, this boundary still requires production container policy, authenticated enqueue paths, durable artifact storage, and operational monitoring.

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
