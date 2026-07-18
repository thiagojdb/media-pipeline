# Relay Product

Status: foundation direction for the rebuild. This document describes the intended product; `MILESTONES.md` distinguishes current work from later outcomes.

## Product statement

Relay is an AI-assisted production workspace for YouTube channels whose videos are scripted and grounded in source material.

It is designed for information-led formats such as:

- news, politics, and debate analysis;
- deep reactions and commentary;
- geography and explanatory videos;
- reviews of other media;
- chess and other domain-specific analysis;
- data-driven stories.

Relay is not initially a general-purpose video editor or a tool for footage-first productions such as vlogs. Its primary job is to connect sources, narration, reusable channel visuals, agent-proposed edits, human feedback, and rendered output.

## Product promise

A channel should be able to move through:

> sources → research → script or narration → timed visual composition → review → final video

Agents perform production work, but their output remains inspectable and correctable. Chat is an interface to work, not the source of truth for the production.

## Core concepts

### Channel

A channel is the collaboration, ownership, and reuse boundary. It contains:

- members and roles;
- projects;
- visual identity, including colors, fonts, spacing, and layouts;
- media and data assets;
- reusable programmatic video components;
- production defaults and later AI configuration.

The first milestone may use a development user, but the data model must include channel membership from the beginning. It must not assume that every record belongs forever to one local owner.

### Project

A project represents one video production. Over time it contains:

- source material and preserved references;
- research notes and claims;
- script versions;
- narration and timing;
- semantic beats or scenes;
- a component-driven composition;
- draft and final renders;
- timestamped review comments.

The rebuild uses dedicated domain records and explicit revisions where history matters. It does not begin with a universal artifact framework.

### Reusable video component

A reusable video component is executable, versioned channel capability. Examples include:

- branded source-video framing;
- animated charts;
- maps or globes;
- chessboards driven by PGN;
- article and quotation treatments;
- talking-mouth animation;
- subtitles, lower thirds, and transitions.

These are React/Remotion video components, not shadcn application-interface components.

Each component declares structured inputs, fixtures, timing behavior, supported dimensions, asset needs, and preview checkpoints. Projects use an exact component version with project-specific inputs. Later component revisions do not silently change an existing project.

## Component-authoring workflow

The central product loop is:

1. A creator describes a component in normal language.
2. Relay starts a bounded Pi coding session in a component workspace.
3. Pi receives the public SDK, allowed tools and dependencies, channel design context, relevant assets and examples, the current source for revisions, and explicit acceptance requirements.
4. Pi writes code and may run checks through the tools Relay grants it.
5. When Pi reports completion, Relay independently validates the candidate.
6. Validation failures are returned to the same session as structured evidence for bounded repair attempts.
7. A passing build becomes a reviewable candidate, not an automatically approved component.
8. The creator exercises fixtures, changes inputs, and inspects arbitrary frames.
9. The creator approves, rejects, or requests another revision.
10. Approval creates an immutable version available to channel projects.

The agent saying “done” is never the acceptance condition.

### Mechanical acceptance

Relay can determine that a candidate:

- respects file and dependency policy;
- compiles and loads;
- has a valid input contract;
- renders its fixtures without runtime errors;
- behaves at selected frame checkpoints;
- can produce a low-resolution preview render;
- remains within attempt, command, token, and wall-time limits.

### Creative acceptance

A creator determines whether the component:

- matches the channel’s visual language;
- communicates the intended information;
- has suitable pacing and animation;
- behaves well with realistic content.

Automated or model-assisted visual critique may later help, but it cannot silently replace creator approval.

## Target video workflow

After the component loop is proven, Relay should support:

1. Create or enter a channel and project.
2. Add URLs, articles, documents, clips, images, audio, and structured data.
3. Import or generate a script, or begin from narration.
4. Associate source evidence with relevant passages and claims.
5. Divide narration into timed semantic beats.
6. Ask an editing agent to propose component instances, media, inputs, and timing.
7. Review the executable composition and preview it with audio.
8. Render a low-resolution draft or selected range.
9. Leave timestamped feedback such as “use the map here” or “slow this chart down.”
10. Let the editing agent propose a bounded revision.
11. Optionally adjust common inputs manually.
12. Render a high-quality final video and subtitles.

The editing agent revises a structured composition. It does not edit an opaque MP4 as its primary model.

## Product principles

1. **Channel reuse is foundational.** Visual components and design context belong to a channel and are reused across projects.
2. **Agent work is reviewable.** Consequential output becomes a candidate or proposal before approval.
3. **Working versions are protected.** Failed revisions never replace the last approved or working version.
4. **Preview and output agree.** A component’s frame semantics must be the same during inspection and rendering.
5. **Sources stay connected.** Later research and editing work must retain the source reference that motivated it.
6. **Narration structures the edit.** Semantic beats and narration timing guide visual composition.
7. **AI use is explicit and bounded.** Real model runs record attempts, usage, cost, and terminal state; CI does not spend model tokens.
8. **Failures are visible and recoverable.** Jobs never appear successful because an agent claimed success or remain silently stuck.
9. **Collaboration is designed in early.** Channel membership is modeled now even though invitations and granular permissions arrive later.
10. **One dependable path beats broad simulation.** Features expand only after the current vertical slice works in the real application.

## Initial non-goals

The first component-loop milestone does not include:

- the complete source-to-final production flow;
- a professional nonlinear editor;
- teams and invitation UI, despite membership-ready data;
- a marketplace for models, providers, or components;
- arbitrary third-party component dependencies;
- public review links or billing;
- advanced audio mixing or color grading;
- detachable subtitle tracks;
- a renderer-independent persisted contract;
- automatic creative approval;
- migration of legacy projects or implementation code.

These are deferrals, not permanent exclusions.
