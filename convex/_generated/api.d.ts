/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as componentAuthoring from "../componentAuthoring.js";
import type * as componentBuildJobs from "../componentBuildJobs.js";
import type * as componentConversation from "../componentConversation.js";
import type * as componentLoop from "../componentLoop.js";
import type * as componentReview from "../componentReview.js";
import type * as projectBeats from "../projectBeats.js";
import type * as projectCompositionSchema from "../projectCompositionSchema.js";
import type * as projectCompositions from "../projectCompositions.js";
import type * as projectDraftRenders from "../projectDraftRenders.js";
import type * as projectEditingAgent from "../projectEditingAgent.js";
import type * as projectNarrations from "../projectNarrations.js";
import type * as projectScriptRevisions from "../projectScriptRevisions.js";
import type * as projects from "../projects.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  componentAuthoring: typeof componentAuthoring;
  componentBuildJobs: typeof componentBuildJobs;
  componentConversation: typeof componentConversation;
  componentLoop: typeof componentLoop;
  componentReview: typeof componentReview;
  projectBeats: typeof projectBeats;
  projectCompositionSchema: typeof projectCompositionSchema;
  projectCompositions: typeof projectCompositions;
  projectDraftRenders: typeof projectDraftRenders;
  projectEditingAgent: typeof projectEditingAgent;
  projectNarrations: typeof projectNarrations;
  projectScriptRevisions: typeof projectScriptRevisions;
  projects: typeof projects;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
