import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFakeCandidateExecutor,
  IsolatedCandidateExecutor,
} from "../../src/component-build/executor.js";
import { ComponentBuildLoop } from "../../src/component-build/loop.js";
import { ComponentBuildService } from "../../src/component-build/service.js";
import { InMemoryComponentBuildJobStore } from "../../src/component-build/store.js";
import type { ComponentBuildJob } from "../../src/component-build/types.js";
import { CandidateWorkspaceManager } from "../../src/component-build/workspace.js";

const roots: string[] = [];
const scaffold = path.resolve("apps/worker/scaffold/component-build");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded component build lifecycle", () => {
  it.each([
    ["export const candidate = true;", "succeeded"],
    ["FIXTURE_INVALID", "failed"],
    ["FIXTURE_TIMEOUT", "needs_intervention"],
    ["FIXTURE_CRASH", "needs_intervention"],
    ["FIXTURE_CANCEL", "canceled"],
  ] as const)(
    "handles deterministic fixture %s as %s",
    async (source, expected) => {
      const { store, loop, root } = await harness(job("job-1", source));
      await expect(loop.tick()).resolves.toBe(true);
      expect(store.jobs.get("job-1")).toMatchObject({
        state: expected,
        channelId: "channel-opaque",
        threadId: "thread-opaque",
        turnId: "turn-opaque",
        parentCandidateId: "candidate-parent",
      });
      if (expected === "succeeded") {
        expect(store.jobs.get("job-1")?.candidateRef).toMatch(
          /^sha256:[a-f0-9]{64}$/,
        );
        expect(store.jobs.get("job-1")?.boundedStdout).toBe(
          "candidate source validated\n",
        );
        expect(store.jobs.get("job-1")?.validationEvidence).toMatchObject({
          schemaVersion: 1,
          fixtureCount: 1,
          checkpointCount: 1,
          renderedFrameCount: 30,
        });
        expect(
          store.jobs
            .get("job-1")
            ?.validationEvidence?.checks.every(
              ({ status }) => status === "passed",
            ),
        ).toBe(true);
      }
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("serializes claims and recovers expired leases within retry bounds", async () => {
    const first = job("first", "export const first = true;");
    const expired = {
      ...job("expired", "export const second = true;"),
      state: "running" as const,
      attempt: 1,
      leaseOwner: "dead-worker",
      leaseExpiresAt: 1,
    };
    const store = new InMemoryComponentBuildJobStore([first, expired]);
    expect(await store.recoverExpired(Date.now())).toBe(1);
    expect(store.jobs.get("expired")?.state).toBe("queued");
    const claimed = await store.claim("worker", 30_000);
    expect(claimed?.id).toBe("first");
    expect(store.jobs.get("expired")?.state).toBe("queued");

    store.jobs.set("expired", {
      ...store.jobs.get("expired")!,
      state: "running",
      attempt: 2,
      leaseOwner: "dead-worker",
      leaseExpiresAt: 1,
    });
    expect(await store.recoverExpired(Date.now())).toBe(1);
    expect(store.jobs.get("expired")?.state).toBe("needs_intervention");
  });

  it("fences expired attempts and prevents canceled candidate publication", async () => {
    const store = new InMemoryComponentBuildJobStore([
      job("fenced", "export const safe = true;"),
    ]);
    const first = await store.claim("same-worker", 30_000);
    expect(first?.attempt).toBe(1);
    store.jobs.set("fenced", {
      ...store.jobs.get("fenced")!,
      leaseExpiresAt: 1,
    });
    await store.recoverExpired(Date.now());
    const second = await store.claim("same-worker", 30_000);
    expect(second?.attempt).toBe(2);
    await expect(
      store.transition("fenced", "same-worker", first!.attempt, {
        state: "validating",
        message: "stale worker",
      }),
    ).rejects.toThrow("expired");

    store.jobs.set("fenced", {
      ...store.jobs.get("fenced")!,
      cancelRequested: true,
    });
    await expect(
      store.transition("fenced", "same-worker", second!.attempt, {
        state: "succeeded",
        message: "must not publish",
        candidateRef: "sha256:stale",
      }),
    ).rejects.toThrow("Canceled build cannot succeed");
  });

  it("cleans orphaned workspaces and fingerprints scaffold revisions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-orphan-test-"));
    roots.push(root);
    const scaffoldCopy = path.join(root, "scaffold");
    await cp(scaffold, scaffoldCopy, { recursive: true });
    const workspaceRoot = path.join(root, "workspaces");
    await mkdir(path.join(workspaceRoot, "abandoned"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "abandoned", "partial"), "x");
    const manager = new CandidateWorkspaceManager(workspaceRoot, scaffoldCopy);
    const before = await manager.validationFingerprint();
    expect(await manager.cleanupOrphans()).toBe(1);
    expect(await readdir(workspaceRoot)).toEqual([]);
    await writeFile(
      path.join(scaffoldCopy, "validate.mjs"),
      "console.log('changed validator');",
    );
    expect(await manager.validationFingerprint()).not.toBe(before);
  });

  it.runIf(existsSync("/usr/bin/bwrap") && existsSync("/usr/bin/prlimit"))(
    "classifies a real isolated process abort as a recoverable crash",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "relay-crash-test-"));
      roots.push(root);
      const manager = new CandidateWorkspaceManager(root, scaffold);
      const workspace = await manager.create(job("crash", "FIXTURE_CRASH"));
      try {
        const result = await new IsolatedCandidateExecutor("crash").execute(
          workspace,
          new AbortController().signal,
        );
        expect(result).toMatchObject({
          status: "crashed",
          code: "build_crashed",
        });
      } finally {
        await manager.remove(workspace);
      }
    },
  );

  it.runIf(existsSync("/usr/bin/bwrap") && existsSync("/usr/bin/prlimit"))(
    "independently compiles the contract and renders every fixture frame in isolation",
    async () => {
      const source = `
        import {defineVideoComponent} from "@relay/component-sdk";
        import {z} from "zod";
        export default defineVideoComponent({
          id: "validation-proof",
          version: "1.0.0",
          schema: z.object({label: z.string()}),
          fps: 30,
          dimensions: {width: 320, height: 180},
          duration: 3,
          assets: [],
          fixtures: [{
            id: "proof",
            name: "Proof",
            input: {label: "Relay"},
            checkpoints: [{label: "start", frame: 0}, {label: "end", frame: 2}],
          }],
          compatibility: {mode: "initial"},
          component: ({input, frame, width, height}) => (
            <svg width={width} height={height}><text>{input.label}:{frame}</text></svg>
          ),
        });
      `;
      const root = await mkdtemp(
        path.join(os.tmpdir(), "relay-validation-test-"),
      );
      roots.push(root);
      const manager = new CandidateWorkspaceManager(root, scaffold);
      const workspace = await manager.create(job("validation", source));
      try {
        const result = await new IsolatedCandidateExecutor().execute(
          workspace,
          new AbortController().signal,
        );
        expect(result.status, JSON.stringify(result, null, 2)).toBe(
          "succeeded",
        );
        expect(result.validationEvidence).toMatchObject({
          schemaVersion: 1,
          fixtureCount: 1,
          checkpointCount: 2,
          renderedFrameCount: 3,
        });
        expect(result.validationEvidence.renderFingerprint).toMatch(
          /^[a-f0-9]{64}$/,
        );
        expect(result.validationEvidence.checks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "source_policy",
              status: "passed",
            }),
            expect.objectContaining({
              code: "typescript_bundle",
              status: "passed",
            }),
            expect.objectContaining({
              code: "component_contract",
              status: "passed",
            }),
            expect.objectContaining({
              code: "preview_runtime",
              status: "passed",
            }),
          ]),
        );
      } finally {
        await manager.remove(workspace);
      }
    },
  );

  it("degrades health without an unhandled rejection when the control plane fails", async () => {
    class FailingStore extends InMemoryComponentBuildJobStore {
      override async recoverExpired(): Promise<number> {
        throw new Error("Convex temporarily unavailable");
      }
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-loop-test-"));
    roots.push(root);
    const store = new FailingStore();
    const workerId = "degraded-worker";
    const service = new ComponentBuildService(
      store,
      new CandidateWorkspaceManager(root, scaffold),
      createFakeCandidateExecutor(),
      workerId,
    );
    const loop = new ComponentBuildLoop(store, service, workerId, 5_000, 10);
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      loop.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(loop.status).toBe("degraded");
      expect(diagnostic).toHaveBeenCalledWith(
        expect.stringContaining("degraded safely"),
      );
    } finally {
      loop.stop();
      diagnostic.mockRestore();
    }
  });

  it("rejects scaffold dependencies and symlinks before execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-policy-test-"));
    roots.push(root);
    const dependencyScaffold = path.join(root, "dependency-scaffold");
    await mkdir(dependencyScaffold);
    await writeFile(
      path.join(dependencyScaffold, "package.json"),
      JSON.stringify({ dependencies: { unexpected: "1.0.0" } }),
    );
    await writeFile(path.join(dependencyScaffold, "validate.mjs"), "");
    const dependencyManager = new CandidateWorkspaceManager(
      path.join(root, "dependency-workspaces"),
      dependencyScaffold,
    );
    await expect(dependencyManager.create(job("deps", "safe"))).rejects.toThrow(
      "dependencies are not allowed",
    );

    const symlinkScaffold = path.join(root, "symlink-scaffold");
    await mkdir(symlinkScaffold);
    await writeFile(path.join(symlinkScaffold, "package.json"), "{}");
    await symlink("/etc/passwd", path.join(symlinkScaffold, "validate.mjs"));
    const symlinkManager = new CandidateWorkspaceManager(
      path.join(root, "symlink-workspaces"),
      symlinkScaffold,
    );
    await expect(symlinkManager.create(job("symlink", "safe"))).rejects.toThrow(
      "symlinks",
    );
  });

  it("rejects source tampering and still removes the disposable workspace", async () => {
    const tampered = { ...job("tampered", "safe"), sourceHash: "0".repeat(64) };
    const { store, loop, root } = await harness(tampered);
    await loop.tick();
    expect(store.jobs.get("tampered")?.state).toBe("failed");
    expect(await readdir(root)).toEqual([]);
  });
});

async function harness(initial: ComponentBuildJob) {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-build-test-"));
  roots.push(root);
  const store = new InMemoryComponentBuildJobStore([initial]);
  const workerId = "test-worker";
  const service = new ComponentBuildService(
    store,
    new CandidateWorkspaceManager(root, scaffold),
    createFakeCandidateExecutor(),
    workerId,
    5_000,
  );
  return {
    root,
    store,
    loop: new ComponentBuildLoop(store, service, workerId, 5_000, 10),
  };
}

function job(id: string, source: string): ComponentBuildJob {
  return {
    id,
    channelId: "channel-opaque",
    threadId: "thread-opaque",
    turnId: "turn-opaque",
    parentCandidateId: "candidate-parent",
    baseSnapshotId: "snapshot-base",
    sourceSnapshot: source,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    state: "queued",
    attempt: 0,
    maxAttempts: 2,
    repairAttempt: 0,
    maxRepairAttempts: 2,
    cancelRequested: false,
  };
}
