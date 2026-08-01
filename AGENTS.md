# Relay Agent Guide

Relay is being rebuilt as an AI-assisted production workspace for scripted, source-based YouTube channels.

## Read before changing code

1. `PRODUCT.md`
2. `ARCHITECTURE.md`
3. `MILESTONES.md`
4. Any task-specific planning document or acceptance criteria supplied by the
   user, when one exists.

Linear is optional. Do not require, create, or update a Linear issue unless the
user explicitly asks for Linear to be part of the work.

## Current phase

Foundation is the active milestone. There is no runnable application until MED-130 establishes it. Do not add placeholder commands or claim verification that does not exist.

`main` is the development branch. `prod` is the production promotion branch.
Production has no worker during alpha; never connect it to the development
worker or development Convex deployment.

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

## Parallel local development

- Give each parallel task its own Git worktree and start it with
  `npm run dev:cell -- <instance-id>`.
- The cell launcher is the supported entry point for isolated local web and
  worker processes. It derives per-cell ports, local data roots, worker tokens,
  and the Next.js build directory; use `--mode real` only when real providers
  are explicitly needed.
- Cell routing is restricted to the `relay-local` Rementor workspace. Never
  point the launcher at the GISS `desenvolvimento` or `qualidade` workspaces.
  Use `npm run dev:cell -- cleanup <instance-id>` to remove a stale route.
- Cells may share the configured development Convex deployment. Configure a
  separate Convex deployment and server tokens when a task must isolate data,
  queues, or mutations as well as local processes.

## Work discipline

- Implement one bounded work item at a time. The user's request can define the
  work directly; a tracking issue is not required.
- Keep changes reviewable and tied to acceptance criteria.
- Verify through the cheapest command that proves the changed boundary, then run the repository gate when it exists.
- For UI behavior, test real routes in a browser rather than relying only on isolated component tests.
- Record material architecture changes explicitly; do not let implementation drift redefine this foundation.
