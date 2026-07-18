# Relay Agent Guide

Relay is being rebuilt as an AI-assisted production workspace for scripted, source-based YouTube channels.

## Read before changing code

1. `PRODUCT.md`
2. `ARCHITECTURE.md`
3. `MILESTONES.md`
4. The active Linear issue and its acceptance criteria

## Current phase

Foundation is the active milestone. There is no runnable application until MED-130 establishes it. Do not add placeholder commands or claim verification that does not exist.

## Source boundaries

- This repository is the only implementation target.
- `../media-pipeline-alpha` is read-only product and failure research.
- Do not copy legacy Java, JavaScript, schemas, renderer code, migrations, tests, or abstractions by default.
- If legacy behavior is worth preserving, restate the product requirement and implement the smallest solution in the new architecture.

## Engineering rules

- Use TypeScript strict mode.
- Prefer direct feature code over speculative frameworks.
- Keep runtime boundaries and state transitions explicit.
- Use Zod at meaningful runtime boundaries; do not duplicate every internal type as a schema.
- Protect approved and working versions from failed agent revisions.
- Never treat an agent completion message as validation evidence.
- Normal tests and CI must not call paid models.
- Keep secrets out of browser payloads, component inputs, source bundles, logs, and renders.
- Do not execute agent-generated code in Next.js or Convex.
- Preview and final rendering must share Remotion frame semantics.
- Model ownership through channels and memberships, even while collaboration UI is deferred.
- Add expensive infrastructure and test suites only when they protect an implemented boundary.

## Work discipline

- Implement one Linear issue at a time.
- Keep changes reviewable and tied to acceptance criteria.
- Verify through the cheapest command that proves the changed boundary, then run the repository gate when it exists.
- For UI behavior, test real routes in a browser rather than relying only on isolated component tests.
- Record material architecture changes explicitly; do not let implementation drift redefine this foundation.
