import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { AuthoringContextPack, AuthoringTurn } from "./types.js";

const MAX_REFERENCE_BYTES = 512_000;
const references = {
  "component-sdk/README.md": "packages/component-sdk/README.md",
  "component-sdk/src/index.ts": "packages/component-sdk/src/index.ts",
  "reference-components/README.md": "packages/reference-components/README.md",
  "reference-components/src/line-chart.tsx":
    "packages/reference-components/src/line-chart.tsx",
} as const;
const credentialKey =
  /(?:^|[-_])(api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)(?:$|[-_])/i;
const credentialLikeValue =
  /(?:\bBearer\s+\S+|\bsk-[a-z0-9_-]{8,}|(?:^|[\s?&])(?:api_?key|signature|token)=[^&\s]+)/i;

export async function buildAuthoringContext(
  turn: AuthoringTurn,
  repositoryRoot: string,
): Promise<{ pack: AuthoringContextPack; json: string; hash: string }> {
  const actualBaseHash = sha256(turn.baseSource);
  if (actualBaseHash !== turn.baseSourceHash)
    throw new Error(
      "Exact base source hash does not match its immutable source.",
    );
  rejectCredentialText(turn.userRequest, "user request");
  turn.acceptanceCriteria.forEach((criterion, index) =>
    rejectCredentialText(criterion, `acceptanceCriteria[${index}]`),
  );
  turn.priorSummaries.forEach((summary, index) =>
    rejectCredentialText(summary, `priorSummaries[${index}]`),
  );
  const theme = parseSafeJson(turn.channelThemeJson, "channel theme");
  const assets = parseSafeJson(turn.assetsMetadataJson, "asset metadata");
  rejectCredentialFields(theme, "channel theme");
  rejectCredentialFields(assets, "asset metadata");
  const validationEvidence = turn.validationEvidenceJson
    ? parseSafeJson(turn.validationEvidenceJson, "validation evidence")
    : undefined;
  rejectCredentialFields(validationEvidence, "validation evidence");

  const loaded: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  let bytes = 0;
  for (const [name, relative] of Object.entries(references)) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
      throw new Error("Authoring reference path violates policy.");
    const absolute = path.join(repositoryRoot, relative);
    const details = await lstat(absolute);
    if (!details.isFile() || details.isSymbolicLink())
      throw new Error(`Authoring reference ${name} must be a regular file.`);
    const content = await readFile(absolute, "utf8");
    bytes += Buffer.byteLength(content);
    if (bytes > MAX_REFERENCE_BYTES)
      throw new Error("Authoring reference context exceeds 512 KB.");
    loaded[name] = content;
    hashes[name] = sha256(content);
  }
  const pack: AuthoringContextPack = {
    schemaVersion: 1,
    turn: {
      channelId: turn.channelId,
      threadId: turn.threadId,
      turnId: turn.turnId,
      userRequest: turn.userRequest,
      acceptanceCriteria: [...turn.acceptanceCriteria],
      parentCandidateId: turn.parentCandidateId,
      baseSnapshotId: turn.baseSnapshotId,
      repairAttempt: turn.repairAttempt,
      maxRepairAttempts: turn.maxRepairAttempts,
    },
    exactBase: { source: turn.baseSource, sha256: turn.baseSourceHash },
    channel: { theme, assets },
    priorSummaries: [...turn.priorSummaries],
    validationEvidence,
    policy: {
      allowedDependencies: ["@relay/component-sdk", "react", "zod"],
      availableTools: [
        "read_authoring_context",
        "replace_candidate_source",
        "check_candidate",
        "declare_candidate_ready",
      ],
      forbiddenCapabilities: [
        "ambient network",
        "environment variables",
        "wall-clock time",
        "unseeded randomness",
        "Remotion hooks",
        "filesystem access outside Relay tools",
      ],
    },
    references: loaded,
    referenceHashes: hashes,
  };
  const json = stableJson(pack);
  if (Buffer.byteLength(json) > 1_000_000)
    throw new Error("Authoring context pack exceeds 1 MB.");
  return { pack, json, hash: sha256(json) };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseSafeJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
}
function rejectCredentialText(value: string, location: string): void {
  if (credentialLikeValue.test(value))
    throw new Error(`${location} contains a credential-like value.`);
}

function rejectCredentialFields(value: unknown, location: string): void {
  if (typeof value === "string" && credentialLikeValue.test(value))
    throw new Error(`${location} contains a credential-like value.`);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectCredentialFields(item, `${location}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (credentialKey.test(key))
      throw new Error(
        `${location} contains forbidden credential-like field ${key}.`,
      );
    rejectCredentialFields(item, `${location}.${key}`);
  }
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
