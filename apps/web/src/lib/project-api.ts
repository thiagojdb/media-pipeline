import "server-only";

import { api } from "../../../../convex/_generated/api";
import type { Id, TableNames } from "../../../../convex/_generated/dataModel";
import type { ProjectComposition } from "../../../../convex/projectCompositionSchema";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";

export type { ProjectComposition };

type Workspace = FunctionReturnType<
  typeof api.projects.bootstrapDevelopmentWorkspace
>;
type ChannelProject = FunctionReturnType<typeof api.projects.list>[number];
type ProjectScriptVersion = NonNullable<
  FunctionReturnType<typeof api.projects.listScriptVersions>["current"]
>;
type ProjectScriptVersionSummary = FunctionReturnType<
  typeof api.projects.listScriptVersions
>["versions"][number];
type ProjectSource = FunctionReturnType<
  typeof api.projects.listSources
>[number];
type ProjectScriptRevisionProposal = FunctionReturnType<
  typeof api.projectScriptRevisions.list
>[number];
type ProjectNarrationVersion = FunctionReturnType<
  typeof api.projectNarrations.list
>["versions"][number];
type ProjectNarrationPlanVersion = FunctionReturnType<
  typeof api.narrationPlans.list
>["versions"][number];
type ProjectNarrationJob = FunctionReturnType<
  typeof api.projectNarrations.list
>["jobs"][number];
type ProjectBeatWorkspace = FunctionReturnType<typeof api.projectBeats.list>;
type ProjectCompositionWorkspace = FunctionReturnType<
  typeof api.projectCompositions.list
>;
type ProjectCompositionProposal = FunctionReturnType<
  typeof api.projectEditingAgent.list
>[number];
type ProjectDraftRender = FunctionReturnType<
  typeof api.projectDraftRenders.list
>[number];

const projects = api.projects;
const scriptRevisions = api.projectScriptRevisions;
const narrationPlans = api.narrationPlans;
const narrations = api.projectNarrations;
const projectBeats = api.projectBeats;
const compositions = api.projectCompositions;
const editingAgent = api.projectEditingAgent;
const draftRenders = api.projectDraftRenders;

let client: ConvexHttpClient | undefined;
let workspacePromise: Promise<Workspace> | undefined;

export async function listProjects(): Promise<{
  channel: Workspace["channel"];
  projects: ChannelProject[];
}> {
  const workspace = await developmentWorkspace();
  const projectList = await convex().query(projects.list, access(workspace));
  return { channel: workspace.channel, projects: projectList };
}

export async function getProject(projectId: string): Promise<{
  channel: Workspace["channel"];
  project: ChannelProject;
}> {
  const workspace = await developmentWorkspace();
  const project = await convex().query(projects.get, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
  return { channel: workspace.channel, project };
}

export async function createProject(input: {
  name: string;
  description?: string | undefined;
}): Promise<{ projectId: string }> {
  const workspace = await developmentWorkspace();
  const projectId = await convex().mutation(projects.create, {
    ...access(workspace),
    name: input.name,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  });
  return { projectId };
}

export async function updateProject(
  projectId: string,
  input: { name: string; description?: string | undefined },
): Promise<void> {
  const workspace = await developmentWorkspace();
  await convex().mutation(projects.rename, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    name: input.name,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  });
}

export async function archiveProject(projectId: string): Promise<void> {
  const workspace = await developmentWorkspace();
  await convex().mutation(projects.archive, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function listProjectScriptVersions(projectId: string): Promise<{
  current: ProjectScriptVersion | null;
  versions: ProjectScriptVersionSummary[];
  maximumCharacters: number;
}> {
  const workspace = await developmentWorkspace();
  return convex().query(projects.listScriptVersions, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
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
    convex().query(projects.get, {
      ...access(workspace),
      projectId: convexId<"projects">(projectId),
    }),
    convex().query(projects.getScriptVersion, {
      ...access(workspace),
      projectId: convexId<"projects">(projectId),
      version,
    }),
  ]);
  return {
    channel: workspace.channel,
    project,
    script,
  };
}

export async function saveProjectScriptVersion(
  projectId: string,
  input: { content: string; provenance: "manual" | "import" },
): Promise<{ scriptVersionId: string; version: number }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(projects.saveScriptVersion, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    ...input,
  });
}

export async function listProjectScriptRevisionProposals(
  projectId: string,
): Promise<ProjectScriptRevisionProposal[]> {
  const workspace = await developmentWorkspace();
  return convex().query(scriptRevisions.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function proposeProjectScriptRevision(
  projectId: string,
  input: {
    baseScriptVersionId: string;
    baseDraft: string;
    instruction: string;
    scope: "selection" | "document";
    selectionFrom: number;
    selectionTo: number;
    selectedText: string;
    replacementMarkdown: string;
    rationale: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    wallTimeMs: number;
  },
): Promise<{ proposalId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(scriptRevisions.propose, {
    ...access(workspace),
    ...input,
    projectId: convexId<"projects">(projectId),
    baseScriptVersionId: convexId<"scriptVersions">(input.baseScriptVersionId),
  });
}

export async function decideProjectScriptRevision(
  projectId: string,
  input: {
    proposalId: string;
    decision: "apply" | "reject";
    baseDraft?: string;
    selectedText?: string;
  },
): Promise<{ proposalId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(scriptRevisions.decide, {
    ...access(workspace),
    ...input,
    projectId: convexId<"projects">(projectId),
    proposalId: convexId<"scriptRevisionProposals">(input.proposalId),
  });
}

export async function listProjectNarrations(projectId: string): Promise<{
  versions: ProjectNarrationVersion[];
  jobs: ProjectNarrationJob[];
}> {
  const workspace = await developmentWorkspace();
  const result = await convex().query(narrations.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
  return { versions: result.versions, jobs: result.jobs };
}

export async function listProjectNarrationPlans(projectId: string): Promise<{
  currentPlanVersionId: string | null;
  versions: ProjectNarrationPlanVersion[];
}> {
  const workspace = await developmentWorkspace();
  return convex().query(narrationPlans.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function createProjectNarrationPlan(
  projectId: string,
  scriptVersionId: string,
): Promise<ProjectNarrationPlanVersion> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrationPlans.createFromScript, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    scriptVersionId: convexId<"scriptVersions">(scriptVersionId),
  });
}

export async function updateProjectNarrationPlan(
  projectId: string,
  planVersionId: string,
  cues: ProjectNarrationPlanVersion["cues"],
): Promise<ProjectNarrationPlanVersion> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrationPlans.updateReviewable, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    planVersionId: convexId<"narrationPlanVersions">(planVersionId),
    cues,
  });
}

export async function approveProjectNarrationPlan(
  projectId: string,
  planVersionId: string,
): Promise<ProjectNarrationPlanVersion> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrationPlans.approve, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    planVersionId: convexId<"narrationPlanVersions">(planVersionId),
  });
}

export async function cancelProjectNarration(
  projectId: string,
  jobId: string,
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrations.requestCancel, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    jobId: convexId<"narrationJobs">(jobId),
  });
}

export async function prepareNarrationUpload(
  projectId: string,
  input: {
    planVersionId: string;
    fileName: string;
    mediaType: string;
    byteSize: number;
  },
): Promise<{ uploadUrl: string; maximumBytes: number }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrations.prepareUpload, {
    ...access(workspace),
    ...input,
    projectId: convexId<"projects">(projectId),
    planVersionId: convexId<"narrationPlanVersions">(input.planVersionId),
  });
}

export async function finalizeNarrationUpload(
  projectId: string,
  input: {
    planVersionId: string;
    storageId: string;
    fileName: string;
    mediaType: string;
  },
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrations.enqueueUpload, {
    ...access(workspace),
    ...input,
    projectId: convexId<"projects">(projectId),
    planVersionId: convexId<"narrationPlanVersions">(input.planVersionId),
    storageId: storageId(input.storageId),
  });
}

export async function approveNarrationAlignment(
  projectId: string,
  narrationVersionId: string,
): Promise<{ narrationVersionId: string; version: number }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(narrations.approveAlignment, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    narrationVersionId: convexId<"narrationVersions">(narrationVersionId),
  });
}

export async function listProjectBeats(
  projectId: string,
): Promise<ProjectBeatWorkspace> {
  const workspace = await developmentWorkspace();
  return convex().query(projectBeats.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
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
  return convex().mutation(projectBeats.replace, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    narrationVersionId: convexId<"narrationVersions">(narrationVersionId),
    beats: beats.map((beat) => ({
      startMs: beat.startMs,
      endMs: beat.endMs,
      title: beat.title,
      ...(beat.summary !== undefined ? { summary: beat.summary } : {}),
    })),
  });
}

export async function listProjectCompositions(
  projectId: string,
): Promise<ProjectCompositionWorkspace> {
  const workspace = await developmentWorkspace();
  return convex().query(compositions.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function saveProjectComposition(
  projectId: string,
  composition: ProjectComposition,
  provenance: "manual" | "agent" = "manual",
): Promise<{ compositionVersionId: string; version: number }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(compositions.save, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    composition,
    provenance,
  });
}

export async function listProjectCompositionProposals(
  projectId: string,
): Promise<ProjectCompositionProposal[]> {
  const workspace = await developmentWorkspace();
  return convex().query(editingAgent.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function proposeProjectCompositionChange(
  projectId: string,
  request: string,
): Promise<{ proposalId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(editingAgent.propose, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    request,
  });
}

export async function decideProjectCompositionProposal(
  projectId: string,
  proposalId: string,
  decision: "accept" | "reject",
) {
  const workspace = await developmentWorkspace();
  const args = {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    proposalId: convexId<"compositionProposals">(proposalId),
  };
  return decision === "accept"
    ? convex().mutation(editingAgent.accept, args)
    : convex().mutation(editingAgent.reject, args);
}

export async function listProjectDraftRenders(
  projectId: string,
): Promise<ProjectDraftRender[]> {
  const workspace = await developmentWorkspace();
  return convex().query(draftRenders.list, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function enqueueProjectDraftRender(
  projectId: string,
  range?: { startMs: number; endMs: number },
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(draftRenders.enqueue, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    ...(range ? { range } : {}),
  });
}

export async function cancelProjectDraftRender(
  projectId: string,
  jobId: string,
): Promise<{ jobId: string }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(draftRenders.requestCancel, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    jobId: convexId<"projectRenderJobs">(jobId),
  });
}

export async function listProjectSources(
  projectId: string,
): Promise<ProjectSource[]> {
  const workspace = await developmentWorkspace();
  return convex().query(projects.listSources, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
  });
}

export async function addProjectUrlSource(
  projectId: string,
  input: { title: string; url: string },
): Promise<{ sourceId: string }> {
  const workspace = await developmentWorkspace();
  const sourceId = await convex().mutation(projects.addUrlSource, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    ...input,
  });
  return { sourceId };
}

export async function prepareProjectFileUpload(
  projectId: string,
  input: { fileName: string; mediaType: string; byteSize: number },
): Promise<{ uploadUrl: string; maximumBytes: number }> {
  const workspace = await developmentWorkspace();
  return convex().mutation(projects.createSourceUploadUrl, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    ...input,
  });
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
  const sourceId = await convex().mutation(projects.addFileSource, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    ...input,
    storageId: storageId(input.storageId),
  });
  return { sourceId };
}

export async function removeProjectSource(
  projectId: string,
  sourceId: string,
): Promise<void> {
  const workspace = await developmentWorkspace();
  await convex().mutation(projects.removeSource, {
    ...access(workspace),
    projectId: convexId<"projects">(projectId),
    sourceId: convexId<"projectSources">(sourceId),
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
    .mutation(projects.bootstrapDevelopmentWorkspace, {
      serverToken,
      identitySubject: process.env.RELAY_DEV_USER_SUBJECT ?? "relay-dev-user",
      userName: process.env.RELAY_DEV_USER_NAME ?? "Relay creator",
      channelSlug: process.env.RELAY_DEV_CHANNEL_SLUG ?? "relay-studio",
      channelName: process.env.RELAY_DEV_CHANNEL_NAME ?? "Relay Studio",
    })
    .catch((error: unknown) => {
      workspacePromise = undefined;
      throw error;
    });
  return workspacePromise;
}

function access(workspace: Workspace) {
  const serverToken = process.env.PROJECTS_SERVER_TOKEN;
  if (!serverToken) throw new Error("Project access is not configured.");
  return {
    serverToken,
    identitySubject: process.env.RELAY_DEV_USER_SUBJECT ?? "relay-dev-user",
    channelId: workspace.channel.id,
  };
}

function convexId<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function storageId(value: string): Id<"_storage"> {
  return value as Id<"_storage">;
}
