import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const api = anyApi.projects!;

export type ChannelProject = {
  _id: string;
  channelId: string;
  creatorMembershipId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

export type ProjectSource = {
  _id: string;
  projectId: string;
  kind: "url" | "file";
  status: "active" | "removed";
  title: string;
  normalizedUrl?: string;
  storageId?: string;
  fileName?: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  hashKind: "reference_sha256" | "file_sha256";
  createdAt: number;
  updatedAt: number;
  downloadUrl?: string;
};

export type ProjectScriptVersion = {
  _id: string;
  projectId: string;
  version: number;
  content: string;
  provenance: "manual" | "import";
  createdAt: number;
};

export type ProjectScriptVersionSummary = {
  _id: string;
  version: number;
  provenance: "manual" | "import";
  characterCount: number;
  excerpt: string;
  createdAt: number;
};

export type ProjectNarrationVersion = {
  _id: string;
  projectId: string;
  scriptVersionId?: string;
  version: number;
  provenance: "generated" | "upload";
  audioUrl?: string;
  mediaType: string;
  durationMs: number;
  timingSegments: Array<{
    index: number;
    startMs: number;
    endMs: number;
    text: string;
  }>;
  provider?: string;
  model?: string;
  fileName?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  usageCharacters?: number;
  estimatedCostUsd?: number;
  wallTimeMs?: number;
  createdAt: number;
};

export type ProjectNarrationJob = {
  _id: string;
  scriptVersionId?: string;
  kind?: "generated" | "upload";
  state:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | "needs_intervention";
  provider: string;
  model: string;
  cancelRequested: boolean;
  terminalCode?: string;
  terminalMessage?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectBeat = {
  _id: string;
  narrationVersionId: string;
  order: number;
  startMs: number;
  endMs: number;
  title: string;
  summary?: string | undefined;
};

export type ProjectBeatWorkspace = {
  currentNarrationVersionId: string | null;
  narrationVersions: Array<{
    _id: string;
    version: number;
    durationMs: number;
  }>;
  beats: ProjectBeat[];
};

export type ProjectComposition = {
  schemaVersion: 1;
  narrationVersionId: string;
  fps: number;
  width: number;
  height: number;
  segments: Array<
    | {
        id: string;
        kind: "component";
        componentVersionId: string;
        input: unknown;
        anchor:
          | { kind: "time"; startMs: number; endMs: number }
          | {
              kind: "beat";
              beatId: string;
              startMs: number;
              endMs: number;
            };
      }
    | {
        id: string;
        kind: "media";
        sourceId: string;
        fit: "cover" | "contain";
        anchor:
          | { kind: "time"; startMs: number; endMs: number }
          | {
              kind: "beat";
              beatId: string;
              startMs: number;
              endMs: number;
            };
      }
  >;
};

export type ProjectCompositionWorkspace = {
  current: {
    _id: string;
    version: number;
    provenance: "manual" | "agent";
    narrationVersionId: string;
    composition: ProjectComposition;
    createdAt: number;
  } | null;
  versions: Array<{
    _id: string;
    version: number;
    provenance: "manual" | "agent";
    narrationVersionId: string;
    segmentCount: number;
    createdAt: number;
  }>;
};

export type ProjectCompositionProposal = {
  _id: string;
  request: string;
  state: "reviewable" | "invalid" | "accepted" | "rejected";
  rationale: string;
  patchJson?: string;
  validationEvidenceJson: string;
  toolActivityJson: string;
  provider: string;
  model: string;
  attempt: number;
  maxAttempts: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  acceptedCompositionVersionId?: string;
  createdAt: number;
};

export type ProjectDraftRender = {
  _id: string;
  compositionVersionId: string;
  narrationVersionId: string;
  rangeKind: "full" | "selection";
  rangeStartMs: number;
  rangeEndMs: number;
  width: number;
  height: number;
  fps: number;
  state:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | "needs_intervention";
  progress: number;
  attempt: number;
  maxAttempts: number;
  cancelRequested: boolean;
  outputUrl?: string | null;
  outputSizeBytes?: number;
  outputContentHash?: string;
  visualFingerprint?: string;
  wallTimeMs?: number;
  terminalCode?: string;
  terminalMessage?: string;
  createdAt: number;
  updatedAt: number;
};

type Workspace = {
  user: { id: string; name: string };
  channel: { id: string; slug: string; name: string };
  membership: { id: string; role: "owner" | "member" };
};

let client: ConvexHttpClient | undefined;
let workspacePromise: Promise<Workspace> | undefined;

export async function listProjects(): Promise<{
  channel: Workspace["channel"];
  projects: ChannelProject[];
}> {
  const workspace = await developmentWorkspace();
  const projects = (await convex().query(api.list!, access(workspace))) as
    ChannelProject[] | undefined;
  return { channel: workspace.channel, projects: projects ?? [] };
}

export async function getProject(projectId: string): Promise<{
  channel: Workspace["channel"];
  project: ChannelProject;
}> {
  const workspace = await developmentWorkspace();
  const project = (await convex().query(api.get!, {
    ...access(workspace),
    projectId,
  })) as ChannelProject;
  return { channel: workspace.channel, project };
}

export async function createProject(input: {
  name: string;
  description?: string | undefined;
}): Promise<{ projectId: string }> {
  const workspace = await developmentWorkspace();
  const projectId = (await convex().mutation(api.create!, {
    ...access(workspace),
    ...input,
  })) as string;
  return { projectId };
}

export async function updateProject(
  projectId: string,
  input: { name: string; description?: string | undefined },
): Promise<void> {
  const workspace = await developmentWorkspace();
  await convex().mutation(api.rename!, {
    ...access(workspace),
    projectId,
    ...input,
  });
}

export async function archiveProject(projectId: string): Promise<void> {
  const workspace = await developmentWorkspace();
  await convex().mutation(api.archive!, {
    ...access(workspace),
    projectId,
  });
}

export async function listProjectScriptVersions(projectId: string): Promise<{
  current: ProjectScriptVersion | null;
  versions: ProjectScriptVersionSummary[];
  maximumCharacters: number;
}> {
  const workspace = await developmentWorkspace();
  return (await convex().query(api.listScriptVersions!, {
    ...access(workspace),
    projectId,
  })) as {
    current: ProjectScriptVersion | null;
    versions: ProjectScriptVersionSummary[];
    maximumCharacters: number;
  };
}

export async function getProjectScriptVersion(
  projectId: string,
  version: number,
): Promise<{
  channel: Workspace["channel"];
  project: ChannelProject;
  script: ProjectScriptVersion;
}> {
  const workspace = await developmentWorkspace();
  const [project, script] = await Promise.all([
    convex().query(api.get!, { ...access(workspace), projectId }),
    convex().query(api.getScriptVersion!, {
      ...access(workspace),
      projectId,
      version,
    }),
  ]);
  return {
    channel: workspace.channel,
    project: project as ChannelProject,
    script: script as ProjectScriptVersion,
  };
}

export async function saveProjectScriptVersion(
  projectId: string,
  input: { content: string; provenance: "manual" | "import" },
): Promise<{ scriptVersionId: string; version: number }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(api.saveScriptVersion!, {
    ...access(workspace),
    projectId,
    ...input,
  })) as { scriptVersionId: string; version: number };
}

export async function listProjectNarrations(projectId: string): Promise<{
  versions: ProjectNarrationVersion[];
  jobs: ProjectNarrationJob[];
}> {
  const workspace = await developmentWorkspace();
  return (await convex().query(anyApi.projectNarrations!.list!, {
    ...access(workspace),
    projectId,
  })) as {
    versions: ProjectNarrationVersion[];
    jobs: ProjectNarrationJob[];
  };
}

export async function generateProjectNarration(
  projectId: string,
  scriptVersionId: string,
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectNarrations!.enqueue!, {
    ...access(workspace),
    projectId,
    scriptVersionId,
  })) as { jobId: string };
}

export async function cancelProjectNarration(
  projectId: string,
  jobId: string,
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectNarrations!.requestCancel!, {
    ...access(workspace),
    projectId,
    jobId,
  })) as { jobId: string };
}

export async function prepareNarrationUpload(
  projectId: string,
  input: { fileName: string; mediaType: string; byteSize: number },
): Promise<{ uploadUrl: string; maximumBytes: number }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectNarrations!.prepareUpload!, {
    ...access(workspace),
    projectId,
    ...input,
  })) as { uploadUrl: string; maximumBytes: number };
}

export async function finalizeNarrationUpload(
  projectId: string,
  input: { storageId: string; fileName: string; mediaType: string },
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectNarrations!.enqueueUpload!, {
    ...access(workspace),
    projectId,
    ...input,
  })) as { jobId: string };
}

export async function listProjectBeats(
  projectId: string,
): Promise<ProjectBeatWorkspace> {
  const workspace = await developmentWorkspace();
  return (await convex().query(anyApi.projectBeats!.list!, {
    ...access(workspace),
    projectId,
  })) as ProjectBeatWorkspace;
}

export async function replaceProjectBeats(
  projectId: string,
  narrationVersionId: string,
  beats: Array<{
    startMs: number;
    endMs: number;
    title: string;
    summary?: string | undefined;
  }>,
): Promise<{ beatIds: string[] }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectBeats!.replace!, {
    ...access(workspace),
    projectId,
    narrationVersionId,
    beats,
  })) as { beatIds: string[] };
}

export async function listProjectCompositions(
  projectId: string,
): Promise<ProjectCompositionWorkspace> {
  const workspace = await developmentWorkspace();
  return (await convex().query(anyApi.projectCompositions!.list!, {
    ...access(workspace),
    projectId,
  })) as ProjectCompositionWorkspace;
}

export async function saveProjectComposition(
  projectId: string,
  composition: ProjectComposition,
  provenance: "manual" | "agent" = "manual",
): Promise<{ compositionVersionId: string; version: number }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectCompositions!.save!, {
    ...access(workspace),
    projectId,
    composition,
    provenance,
  })) as { compositionVersionId: string; version: number };
}

export async function listProjectCompositionProposals(
  projectId: string,
): Promise<ProjectCompositionProposal[]> {
  const workspace = await developmentWorkspace();
  return (await convex().query(anyApi.projectEditingAgent!.list!, {
    ...access(workspace),
    projectId,
  })) as ProjectCompositionProposal[];
}

export async function proposeProjectCompositionChange(
  projectId: string,
  request: string,
): Promise<{ proposalId: string }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectEditingAgent!.propose!, {
    ...access(workspace),
    projectId,
    request,
  })) as { proposalId: string };
}

export async function decideProjectCompositionProposal(
  projectId: string,
  proposalId: string,
  decision: "accept" | "reject",
): Promise<{ compositionVersionId?: string; version?: number }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(
    decision === "accept"
      ? anyApi.projectEditingAgent!.accept!
      : anyApi.projectEditingAgent!.reject!,
    {
      ...access(workspace),
      projectId,
      proposalId,
    },
  )) as { compositionVersionId?: string; version?: number };
}

export async function listProjectDraftRenders(
  projectId: string,
): Promise<ProjectDraftRender[]> {
  const workspace = await developmentWorkspace();
  return (await convex().query(anyApi.projectDraftRenders!.list!, {
    ...access(workspace),
    projectId,
  })) as ProjectDraftRender[];
}

export async function enqueueProjectDraftRender(
  projectId: string,
  range?: { startMs: number; endMs: number },
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectDraftRenders!.enqueue!, {
    ...access(workspace),
    projectId,
    ...(range ? { range } : {}),
  })) as { jobId: string };
}

export async function cancelProjectDraftRender(
  projectId: string,
  jobId: string,
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(anyApi.projectDraftRenders!.requestCancel!, {
    ...access(workspace),
    projectId,
    jobId,
  })) as { jobId: string };
}

export async function listProjectSources(
  projectId: string,
): Promise<ProjectSource[]> {
  const workspace = await developmentWorkspace();
  return (await convex().query(api.listSources!, {
    ...access(workspace),
    projectId,
  })) as ProjectSource[];
}

export async function addProjectUrlSource(
  projectId: string,
  input: { title: string; url: string },
): Promise<{ sourceId: string }> {
  const workspace = await developmentWorkspace();
  const sourceId = (await convex().mutation(api.addUrlSource!, {
    ...access(workspace),
    projectId,
    ...input,
  })) as string;
  return { sourceId };
}

export async function prepareProjectFileUpload(
  projectId: string,
  input: { fileName: string; mediaType: string; byteSize: number },
): Promise<{ uploadUrl: string; maximumBytes: number }> {
  const workspace = await developmentWorkspace();
  return (await convex().mutation(api.createSourceUploadUrl!, {
    ...access(workspace),
    projectId,
    ...input,
  })) as { uploadUrl: string; maximumBytes: number };
}

export async function addProjectFileSource(
  projectId: string,
  input: {
    title: string;
    fileName: string;
    mediaType: string;
    storageId: string;
  },
): Promise<{ sourceId: string }> {
  const workspace = await developmentWorkspace();
  const sourceId = (await convex().mutation(api.addFileSource!, {
    ...access(workspace),
    projectId,
    ...input,
  })) as string;
  return { sourceId };
}

export async function removeProjectSource(
  projectId: string,
  sourceId: string,
): Promise<void> {
  const workspace = await developmentWorkspace();
  await convex().mutation(api.removeSource!, {
    ...access(workspace),
    projectId,
    sourceId,
  });
}

function convex(): ConvexHttpClient {
  if (client) return client;
  const url =
    process.env.PROJECTS_CONVEX_URL ??
    process.env.CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Project storage is not configured.");
  client = new ConvexHttpClient(url);
  return client;
}

function developmentWorkspace(): Promise<Workspace> {
  if (workspacePromise) return workspacePromise;
  const serverToken = process.env.PROJECTS_SERVER_TOKEN;
  if (!serverToken) throw new Error("Project access is not configured.");
  workspacePromise = convex()
    .mutation(api.bootstrapDevelopmentWorkspace!, {
      serverToken,
      identitySubject: process.env.RELAY_DEV_USER_SUBJECT ?? "relay-dev-user",
      userName: process.env.RELAY_DEV_USER_NAME ?? "Relay creator",
      channelSlug: process.env.RELAY_DEV_CHANNEL_SLUG ?? "relay-studio",
      channelName: process.env.RELAY_DEV_CHANNEL_NAME ?? "Relay Studio",
    })
    .catch((error: unknown) => {
      workspacePromise = undefined;
      throw error;
    }) as Promise<Workspace>;
  return workspacePromise;
}

function access(workspace: Workspace) {
  return {
    serverToken: process.env.PROJECTS_SERVER_TOKEN!,
    identitySubject: process.env.RELAY_DEV_USER_SUBJECT ?? "relay-dev-user",
    channelId: workspace.channel.id,
  };
}
