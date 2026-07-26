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
