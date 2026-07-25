import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2_000;
const MAX_IDENTITY_SUBJECT = 200;
const MAX_SLUG = 80;
const MAX_SOURCE_TITLE = 200;
const MAX_SOURCE_URL = 2_048;
const MAX_FILE_NAME = 255;
export const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_SOURCE_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "video/mp4",
  "video/webm",
]);

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};

export const bootstrapDevelopmentWorkspace = mutation({
  args: {
    serverToken: v.string(),
    identitySubject: v.string(),
    userName: v.string(),
    userEmail: v.optional(v.string()),
    channelSlug: v.string(),
    channelName: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.serverToken);
    const identitySubject = requiredText(
      args.identitySubject,
      "identitySubject",
      MAX_IDENTITY_SUBJECT,
    );
    const userName = requiredText(args.userName, "userName", MAX_NAME);
    const userEmail = optionalText(args.userEmail, "userEmail", 320);
    const channelSlug = requiredText(args.channelSlug, "channelSlug", MAX_SLUG);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(channelSlug)) {
      throw new Error("channelSlug must contain lowercase words and hyphens.");
    }
    const channelName = requiredText(args.channelName, "channelName", MAX_NAME);
    const now = Date.now();

    let user = await ctx.db
      .query("users")
      .withIndex("by_identity_subject", (q) =>
        q.eq("identitySubject", identitySubject),
      )
      .unique();
    if (!user) {
      const userId = await ctx.db.insert("users", {
        identitySubject,
        name: userName,
        ...(userEmail ? { email: userEmail } : {}),
        createdAt: now,
        updatedAt: now,
      });
      user = await ctx.db.get(userId);
    }
    if (!user) throw new Error("Development user could not be created.");

    let channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", channelSlug))
      .unique();
    if (!channel) {
      const channelId = await ctx.db.insert("channels", {
        slug: channelSlug,
        name: channelName,
        createdAt: now,
        updatedAt: now,
      });
      channel = await ctx.db.get(channelId);
    }
    if (!channel) throw new Error("Development channel could not be created.");

    let membership = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", user._id),
      )
      .unique();
    if (!membership) {
      const membershipId = await ctx.db.insert("channelMemberships", {
        channelId: channel._id,
        userId: user._id,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
      membership = await ctx.db.get(membershipId);
    }
    if (!membership)
      throw new Error("Development membership could not be created.");

    return {
      user: { id: user._id, name: user.name },
      channel: { id: channel._id, slug: channel.slug, name: channel.name },
      membership: { id: membership._id, role: membership.role },
    };
  },
});

export const list = query({
  args: accessArgs,
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_channel_updated", (q) =>
        q.eq("channelId", membership.channelId),
      )
      .order("desc")
      .collect();
    return projects.sort((left, right) => {
      if (left.status !== right.status)
        return left.status === "active" ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    });
  },
});

export const get = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.channelId !== membership.channelId) {
      throw new Error("Project was not found.");
    }
    return project;
  },
});

export const create = mutation({
  args: {
    ...accessArgs,
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args);
    const now = Date.now();
    return ctx.db.insert("projects", {
      channelId: membership.channelId,
      creatorMembershipId: membership._id,
      name: requiredText(args.name, "name", MAX_NAME),
      ...(optionalText(args.description, "description", MAX_DESCRIPTION)
        ? {
            description: optionalText(
              args.description,
              "description",
              MAX_DESCRIPTION,
            ),
          }
        : {}),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const description = optionalText(
      args.description,
      "description",
      MAX_DESCRIPTION,
    );
    await ctx.db.patch(project._id, {
      name: requiredText(args.name, "name", MAX_NAME),
      description,
      updatedAt: Date.now(),
    });
    return project._id;
  },
});

export const archive = mutation({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.channelId !== membership.channelId) {
      throw new Error("Project was not found.");
    }
    if (project.status === "archived") return project._id;
    const now = Date.now();
    await ctx.db.patch(project._id, {
      status: "archived",
      archivedAt: now,
      updatedAt: now,
    });
    return project._id;
  },
});

export const listSources = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    const sources = await ctx.db
      .query("projectSources")
      .withIndex("by_project_status_created", (q) =>
        q.eq("projectId", project._id).eq("status", "active"),
      )
      .order("desc")
      .collect();
    return Promise.all(
      sources.map(async (source) => ({
        ...source,
        downloadUrl: source.storageId
          ? await ctx.storage.getUrl(source.storageId)
          : undefined,
      })),
    );
  },
});

export const addUrlSource = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    title: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const normalizedUrl = normalizeSourceUrl(args.url);
    const now = Date.now();
    return ctx.db.insert("projectSources", {
      channelId: project.channelId,
      projectId: project._id,
      addedByMembershipId: project.membership._id,
      kind: "url",
      status: "active",
      title: requiredText(args.title, "title", MAX_SOURCE_TITLE),
      normalizedUrl,
      mediaType: "text/html",
      byteSize: 0,
      contentHash: await sha256(normalizedUrl),
      hashKind: "reference_sha256",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createSourceUploadUrl = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    fileName: v.string(),
    mediaType: v.string(),
    byteSize: v.number(),
  },
  handler: async (ctx, args) => {
    await editableProject(ctx, args);
    requiredText(args.fileName, "fileName", MAX_FILE_NAME);
    validateFile(args.mediaType, args.byteSize);
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      maximumBytes: MAX_SOURCE_FILE_BYTES,
    };
  },
});

export const addFileSource = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    title: v.string(),
    fileName: v.string(),
    mediaType: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const title = requiredText(args.title, "title", MAX_SOURCE_TITLE);
    const fileName = requiredText(args.fileName, "fileName", MAX_FILE_NAME);
    const existing = await ctx.db
      .query("projectSources")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) throw new Error("This uploaded file is already a source.");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("The uploaded file was not found.");
    const declaredMediaType = normalizedMediaType(args.mediaType);
    validateFile(declaredMediaType, metadata.size);
    if (
      metadata.contentType &&
      normalizedMediaType(metadata.contentType) !== declaredMediaType
    ) {
      throw new Error("The uploaded file type does not match its declaration.");
    }
    const now = Date.now();
    return ctx.db.insert("projectSources", {
      channelId: project.channelId,
      projectId: project._id,
      addedByMembershipId: project.membership._id,
      kind: "file",
      status: "active",
      title,
      storageId: args.storageId,
      fileName,
      mediaType: declaredMediaType,
      byteSize: metadata.size,
      contentHash: metadata.sha256,
      hashKind: "file_sha256",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const removeSource = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    sourceId: v.id("projectSources"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.projectId !== project._id) {
      throw new Error("Project source was not found.");
    }
    if (source.status === "removed") return source._id;
    const now = Date.now();
    await ctx.db.patch(source._id, {
      status: "removed",
      removedAt: now,
      updatedAt: now,
    });
    return source._id;
  },
});

type AccessArgs = {
  serverToken: string;
  identitySubject: string;
  channelId: Id<"channels">;
};

async function requireMembership(
  ctx: QueryCtx | MutationCtx,
  args: AccessArgs,
) {
  authorize(args.serverToken);
  const identitySubject = requiredText(
    args.identitySubject,
    "identitySubject",
    MAX_IDENTITY_SUBJECT,
  );
  const user = await ctx.db
    .query("users")
    .withIndex("by_identity_subject", (q) =>
      q.eq("identitySubject", identitySubject),
    )
    .unique();
  if (!user) throw new Error("Channel membership is required.");
  const membership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", args.channelId).eq("userId", user._id),
    )
    .unique();
  if (!membership) throw new Error("Channel membership is required.");
  return membership;
}

async function editableProject(
  ctx: MutationCtx,
  args: AccessArgs & { projectId: Id<"projects"> },
) {
  const membership = await requireMembership(ctx, args);
  const project = await ctx.db.get(args.projectId);
  if (!project || project.channelId !== membership.channelId) {
    throw new Error("Project was not found.");
  }
  if (project.status === "archived") {
    throw new Error("Archived projects are read-only.");
  }
  return { ...project, membership };
}

async function readableProject(
  ctx: QueryCtx | MutationCtx,
  args: AccessArgs & { projectId: Id<"projects"> },
) {
  const membership = await requireMembership(ctx, args);
  const project = await ctx.db.get(args.projectId);
  if (!project || project.channelId !== membership.channelId) {
    throw new Error("Project was not found.");
  }
  return { ...project, membership };
}

function authorize(token: string): void {
  const expected = process.env.PROJECTS_SERVER_TOKEN;
  if (!expected || token !== expected) {
    throw new Error("Project authorization failed.");
  }
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) {
    throw new Error(`${label} must be at most ${maximum} characters.`);
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  label: string,
  maximum: number,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) {
    throw new Error(`${label} must be at most ${maximum} characters.`);
  }
  return normalized;
}

function normalizeSourceUrl(value: string): string {
  const raw = requiredText(value, "url", MAX_SOURCE_URL);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Enter a valid http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https source URLs are allowed.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Source URLs cannot contain credentials.");
  }
  for (const key of parsed.searchParams.keys()) {
    if (
      /(?:access[_-]?token|api[_-]?key|secret|password|passwd|auth(?:orization)?|signature|credential|session|jwt)/i.test(
        key,
      )
    ) {
      throw new Error("Remove credentials and secret parameters from the URL.");
    }
  }
  parsed.hash = "";
  const normalized = parsed.toString();
  if (normalized.length > MAX_SOURCE_URL) {
    throw new Error(`url must be at most ${MAX_SOURCE_URL} characters.`);
  }
  return normalized;
}

function validateFile(mediaType: string, byteSize: number): void {
  const normalized = normalizedMediaType(mediaType);
  if (!ALLOWED_SOURCE_MEDIA_TYPES.has(normalized)) {
    throw new Error("This file type is not allowed for project sources.");
  }
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new Error("The source file must contain data.");
  }
  if (byteSize > MAX_SOURCE_FILE_BYTES) {
    throw new Error("The source file is larger than the 25 MB limit.");
  }
}

function normalizedMediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
