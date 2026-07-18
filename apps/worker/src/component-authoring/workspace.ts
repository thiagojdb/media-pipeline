import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { AuthoringWorkspace } from "./types.js";

const MAX_SOURCE_BYTES = 256_000;

export class AuthoringWorkspaceManager {
  constructor(private readonly root: string) {}

  async cleanupOrphans(): Promise<number> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root);
    await Promise.all(
      entries.map((entry) => this.remove(path.join(this.root, entry))),
    );
    return entries.length;
  }

  async create(
    contextJson: string,
    baseSource: string,
  ): Promise<AuthoringWorkspace> {
    boundedSource(baseSource);
    if (Buffer.byteLength(contextJson) > 1_000_000)
      throw new Error("Authoring context exceeds 1 MB.");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const resolvedRoot = await realpath(this.root);
    const workspace = path.join(resolvedRoot, randomUUID());
    await mkdir(workspace, { mode: 0o700 });
    const contextPath = path.join(workspace, "authoring-context.json");
    const candidatePath = path.join(workspace, "candidate-source.tsx");
    try {
      await writeFile(contextPath, contextJson, { flag: "wx", mode: 0o400 });
      await writeFile(candidatePath, baseSource, { flag: "wx", mode: 0o600 });
      await chmod(contextPath, 0o400);
      await assertWorkspace(workspace);
    } catch (error) {
      await this.remove(workspace);
      throw error;
    }
    return {
      root: workspace,
      contextPath,
      candidatePath,
      readContext: () => readRegularFile(contextPath),
      readCandidate: () => readRegularFile(candidatePath),
      replaceCandidate: async (source) => {
        boundedSource(source);
        const details = await lstat(candidatePath);
        if (!details.isFile() || details.isSymbolicLink())
          throw new Error("Candidate source path is not a regular file.");
        await writeFile(candidatePath, source, { mode: 0o600 });
      },
      remove: () => this.remove(workspace),
    };
  }

  async remove(workspace: string): Promise<void> {
    const root = path.resolve(this.root);
    const target = path.resolve(workspace);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new Error(
        "Refusing to remove an authoring workspace outside its root.",
      );
    await rm(target, { recursive: true, force: true });
  }
}

async function assertWorkspace(workspace: string): Promise<void> {
  const entries = await readdir(workspace);
  if (
    entries.length !== 2 ||
    !entries.includes("authoring-context.json") ||
    !entries.includes("candidate-source.tsx")
  )
    throw new Error("Authoring workspace contains unexpected files.");
  for (const entry of entries) {
    const details = await lstat(path.join(workspace, entry));
    if (!details.isFile() || details.isSymbolicLink())
      throw new Error("Authoring workspace symlinks are forbidden.");
  }
}
async function readRegularFile(file: string): Promise<string> {
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink())
    throw new Error("Authoring workspace path is not a regular file.");
  return readFile(file, "utf8");
}
function boundedSource(source: string): void {
  if (!source || Buffer.byteLength(source) > MAX_SOURCE_BYTES)
    throw new Error("Candidate source must be between 1 byte and 256 KB.");
}
