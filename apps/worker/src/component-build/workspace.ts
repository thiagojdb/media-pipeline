import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { ComponentBuildJob } from "./types.js";

const ALLOWED_FILES = new Set([
  "candidate-source.tsx",
  "package.json",
  "validate.mjs",
]);
const MAX_FILE_BYTES = 256_000;
const MAX_TOTAL_BYTES = 512_000;
const MAX_FILES = 8;

export class CandidateWorkspaceManager {
  constructor(
    private readonly root: string,
    private readonly scaffold: string,
  ) {}

  async validationFingerprint(): Promise<string> {
    const hash = createHash("sha256");
    for (const file of ["package.json", "validate.mjs"] as const) {
      hash.update(file);
      hash.update(await readFile(path.join(this.scaffold, file)));
    }
    hash.update("workspace-policy-v2-structured-validation");
    return hash.digest("hex");
  }

  async cleanupOrphans(): Promise<number> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      const target = path.join(this.root, entry.name);
      await this.remove(target);
      removed += 1;
    }
    return removed;
  }

  async create(job: ComponentBuildJob): Promise<string> {
    const encoded = Buffer.from(job.sourceSnapshot);
    if (encoded.byteLength === 0 || encoded.byteLength > MAX_FILE_BYTES)
      throw new Error("Candidate source must be between 1 byte and 256 KB.");
    const actualHash = createHash("sha256").update(encoded).digest("hex");
    if (actualHash !== job.sourceHash)
      throw new Error("Candidate source hash mismatch.");

    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const resolvedRoot = await realpath(this.root);
    const workspace = path.join(resolvedRoot, randomUUID());
    await mkdir(workspace, { mode: 0o700 });
    try {
      await cp(this.scaffold, workspace, {
        recursive: true,
        errorOnExist: true,
      });
      await writeFile(path.join(workspace, "candidate-source.tsx"), encoded, {
        flag: "wx",
        mode: 0o600,
      });
      await this.assertPolicy(workspace);
      return workspace;
    } catch (error) {
      await this.remove(workspace);
      throw error;
    }
  }

  async remove(workspace: string): Promise<void> {
    const resolvedRoot = path.resolve(this.root);
    const resolvedWorkspace = path.resolve(workspace);
    if (!resolvedWorkspace.startsWith(`${resolvedRoot}${path.sep}`))
      throw new Error(
        "Refusing to remove a workspace outside the configured root.",
      );
    await rm(resolvedWorkspace, { force: true, recursive: true });
  }

  private async assertPolicy(workspace: string): Promise<void> {
    const entries = await readdir(workspace, { recursive: true });
    if (entries.length > MAX_FILES)
      throw new Error("Workspace contains too many files.");
    let total = 0;
    for (const relative of entries) {
      if (
        path.isAbsolute(relative) ||
        relative.includes("..") ||
        relative.includes(path.sep)
      )
        throw new Error("Nested or traversing workspace paths are forbidden.");
      if (!ALLOWED_FILES.has(relative))
        throw new Error(`Workspace file ${relative} is not allowed.`);
      const absolute = path.join(workspace, relative);
      const details = await lstat(absolute);
      if (!details.isFile() || details.isSymbolicLink())
        throw new Error("Workspace symlinks and non-files are forbidden.");
      if (details.size > MAX_FILE_BYTES)
        throw new Error("Workspace file exceeds 256 KB.");
      total += details.size;
    }
    if (total > MAX_TOTAL_BYTES) throw new Error("Workspace exceeds 512 KB.");
    const manifest = JSON.parse(
      await readFile(path.join(workspace, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    if (
      Object.keys(manifest.dependencies ?? {}).length > 0 ||
      Object.keys(manifest.devDependencies ?? {}).length > 0
    )
      throw new Error("Candidate workspace dependencies are not allowed.");
  }
}
