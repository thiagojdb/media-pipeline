import { createHash } from "node:crypto";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IsolatedCandidateExecutor } from "./executor.js";
import { CandidateWorkspaceManager } from "./workspace.js";

const root = await mkdtemp(path.join(os.tmpdir(), "relay-isolation-smoke-"));
const source = "ISOLATION_PROBE\nexport const isolated = true;";
const manager = new CandidateWorkspaceManager(
  root,
  fileURLToPath(new URL("../../scaffold/component-build", import.meta.url)),
);
try {
  const workspace = await manager.create({
    id: "smoke",
    channelId: "smoke-channel",
    threadId: "smoke-thread",
    turnId: "smoke-turn",
    sourceSnapshot: source,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    state: "running",
    attempt: 1,
    maxAttempts: 1,
    repairAttempt: 0,
    maxRepairAttempts: 0,
    cancelRequested: false,
    leaseOwner: "smoke-worker",
  });
  try {
    process.env.RELAY_ISOLATION_PROBE_SECRET = "must-not-leak";
    const result = await new IsolatedCandidateExecutor("isolation").execute(
      workspace,
      new AbortController().signal,
    );
    delete process.env.RELAY_ISOLATION_PROBE_SECRET;
    if (result.status !== "succeeded")
      throw new Error(
        `Isolation smoke failed: ${result.code}: ${result.stderr}`,
      );
    if (!result.stdout.includes("isolation probes passed"))
      throw new Error(
        "Isolation smoke did not execute its adversarial probes.",
      );
    if (await exists("/host-write-probe"))
      throw new Error("Sandbox root write escaped onto the host filesystem.");
    console.log(
      JSON.stringify({
        result: "passed",
        isolation: "bubblewrap",
        network: "blocked and probed",
        hostHomes: "hidden and probed",
        hostWrites: "blocked and probed",
        parentEnvironment: "cleared and probed",
        workspace: "read-only and probed",
        command: "validate_candidate",
      }),
    );
  } finally {
    await manager.remove(workspace);
  }
  if ((await readdir(root)).length !== 0)
    throw new Error("Smoke workspace was not cleaned.");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
