# Relay Delivery Milestones

Status: ordered delivery plan. Linear is the task-tracking surface; this file explains why the work is sequenced this way and defines milestone gates.

## Delivery rule

Relay expands one working vertical slice at a time. A milestone is complete only when its golden workflow works through the real application and its important failures are recoverable.

Issue completion, generated code volume, passing isolated tests, or an agent’s success claim is not sufficient evidence by itself.

Foundation and Dependable Component Loop are fully decomposed. M2 begins with one proven bridge issue for the channel component library; its remaining work stays outcome-level until that reusable boundary is exercised.

## M0 — Foundation

**Linear milestone:** Foundation  
**Immediate issues:** MED-132, MED-130, MED-126

### Outcome

Establish a small TypeScript repository and a component contract that subsequent agents can understand and change safely.

### Work

1. **MED-132 — Document the Relay rebuild product and architecture foundation**
   - Product model and workflow
   - Technical boundaries
   - Milestone gates and deferrals
   - Alpha lessons and read-only boundary

2. **MED-130 — Scaffold the minimal TypeScript workspace**
   - Next.js, Convex, Tailwind, and shadcn/ui
   - Worker application
   - Component SDK, testkit, and rendering package boundaries
   - One local start path and a small verification gate

3. **MED-126 — Define the minimal reusable video-component contract**
   - Zod inputs
   - Frame, duration, dimensions, theme, and assets
   - Fixtures and checkpoint frames
   - Determinism and compatibility rules

### Definition of done

- [ ] The repository has one documented local startup path.
- [ ] Format, lint, typecheck, unit tests, and production build pass from a clean checkout.
- [ ] Product, architecture, and agent instructions agree.
- [ ] The component contract can represent chart, map, chess, subtitle, and branded-media families without family-specific SDK branches.
- [ ] Valid and invalid component examples prove the contract mechanically.
- [ ] No legacy code or speculative infrastructure has entered the rebuild.

## M1 — Dependable Component Loop

**Linear milestone:** Dependable Component Loop  
**Issues:** MED-123 through MED-129, MED-131, MED-133, MED-135 through MED-140, with Foundation dependencies

### Product outcome

A creator can ask Pi to build a channel component, receive a mechanically valid candidate, inspect it at arbitrary frames, request a revision, approve an immutable version, and render a low-resolution MP4.

### Delivery order

The implementation should generally progress through these proof layers:

1. **Reference behavior without AI**
   - MED-127: manually authored animated line chart
   - MED-129: fixtures, input controls, playback, and frame scrubbing
   - MED-131: low-resolution Remotion draft render

2. **Durable and isolated execution**
   - MED-133: job lifecycle and bounded workspaces
   - Deterministic fake-agent paths for tests

3. **Real coding agent**
   - MED-128: Pi SDK integration with constrained context and tools
   - MED-123: independent validation and bounded repair

4. **Human acceptance and history**
   - MED-125: review, approval, rejection, revisions, and exact pins

5. **Whole-loop proof**
   - MED-124: real-page golden flow and one explicit metered Pi run
   - MED-135: conversational creator workspace and visible agent progress
   - MED-136: exact generated source, sandboxed preview, chat revisions, and immutable approval
   - MED-137: streamed multi-turn dialogue and an explicit model-controlled implementation handoff
   - MED-138: one skill-driven Relay session, controlled research, auto-compaction, and context/cost telemetry
   - MED-139: stable in-chat preview playback and frame seeking
   - MED-140: durable conversation restoration through reloads and shareable thread URLs

This order separates SDK/rendering defects from agent defects. Pi should not be asked to target an unproven component environment.

### Golden workflow

1. Configure a channel’s colors and fonts.
2. Discuss an animated line chart with Relay and answer its clarifying questions.
3. Observe the explicit transition from lightweight dialogue into bounded agent activity and independent validation.
4. If validation fails, observe structured repair without manual developer edits.
5. Exercise fixtures and change valid component inputs.
6. Play, seek, and inspect arbitrary frames.
7. Render and download a low-resolution MP4.
8. Request: “Make the line red and add an option to animate it being drawn.”
9. Review the successor candidate and compare it with the prior version.
10. Approve the revision while retaining both exact versions.
11. Re-render either version reproducibly.

### Definition of done

- [ ] The golden workflow completes through real application routes.
- [ ] No developer manually edits generated component code during the successful proof run.
- [ ] Pi’s completion claim cannot bypass independent validation.
- [ ] Invalid and failed revisions preserve the last working version.
- [ ] Preview and low-resolution render agree at selected checkpoints.
- [ ] Existing inputs and versions remain reproducible after a successor is approved.
- [ ] Agent attempts, tool activity, usage/cost, wall time, and terminal state are recorded.
- [ ] Provider stalls and operational retry exhaustion become recoverable `needs_intervention` states rather than infinite loops; token and cost totals remain telemetry only.
- [ ] Ordinary CI uses a fake agent and spends no model tokens.
- [ ] One explicit real-Pi dogfood run passes with context, usage, and estimated cost recorded.
- [ ] Residual limitations are documented before M2 starts.

### Explicit non-goals

- Full project timeline
- Source ingestion and research automation
- Narration alignment
- Component marketplace
- Team invitation UI
- Manual source-code editor
- Final-quality long-form render
- Arbitrary dependency installation

## M2 — Source-to-Draft Video

**Linear milestone:** Source-to-Draft Video
**Next issue:** MED-149 — Insert approved channel components into the composition

### Outcome

A channel member can create a project, add source material, produce or import script/narration, establish timed semantic beats, and have an editing agent propose a component-driven draft composition.

### Expected scope

- Approved channel component library, immutable version history, and fresh exact-version revision chats
- Channel and membership-backed projects
- Basic URL and file sources
- Script editing or import
- Generated narration or uploaded narration with the minimum timing path
- Semantic beats
- Channel component library insertion
- Structured composition with exact component versions and inputs
- Editing-agent proposals scoped to beats or ranges
- Preview with narration

### Delivery order

M1 and the MED-141 component-library bridge are complete. M2 is decomposed as
MED-142 through MED-153 and proceeds through these dependency layers:

1. MED-142 establishes membership-backed channel projects.
2. MED-143, MED-144, and MED-146 add sources, versioned scripts, and uploaded narration.
3. MED-145 and MED-147 add generated narration and timed semantic beats.
4. MED-148 and MED-149 establish the immutable composition model and manual component insertion.
5. MED-150 through MED-152 add synchronized preview, agent proposals, and draft rendering.
6. MED-153 proves the complete source-to-draft workflow with a real dogfood run.

## M3 — Review-to-Final Video

**Linear milestone:** Review-to-Final Video

### Outcome

A creator or channel collaborator can render a draft, leave timestamped feedback, request bounded editing revisions, and produce a high-quality final video with subtitles.

### Expected scope

- Low-resolution full-project and selected-range drafts
- Timestamped comments
- Agent-proposed composition revisions
- Manual controls for frequent component inputs and timing corrections
- Burned-in subtitles initially
- Audio and visual conformance checks
- Final render and download
- Clear stale, failed, canceled, and superseded states

### Gate before decomposition

Detailed M3 planning waits until a real M2 draft video exposes the actual review and rendering needs. Do not prebuild a professional nonlinear editor.

## Later product areas

These remain important but are intentionally outside the current plan:

- invitation and member-management UI;
- granular channel roles and permissions;
- realtime collaborative editing;
- public review links;
- detachable subtitle tracks;
- broader component families and dependency policy;
- provider and model configuration marketplace;
- deployment-grade multi-tenant isolation;
- object-storage migration and scalable render workers;
- performance, cache, and compute-cost optimization based on measurements;
- migration tooling for selected legacy data, if users actually need it.

Each later area requires a demonstrated product need and a new milestone or explicit architecture decision.
