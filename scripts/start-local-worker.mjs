import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const localEnvFile = path.resolve(".env.local");
if (process.env.RELAY_DEV_CELL !== "true" && (await fileExists(localEnvFile)))
  process.loadEnvFile(localEnvFile);

const workerPort = process.env.RELAY_LOCAL_WORKER_PORT ?? "3213";
const workerAuthToken =
  process.env.RELAY_LOCAL_WORKER_AUTH_TOKEN ??
  process.env.RELAY_WORKER_AUTH_TOKEN ??
  "relay-local-worker";
const instanceRoot = path.resolve(
  process.env.RELAY_INSTANCE_ROOT ?? path.join(".relay"),
);
const renderOutputDirectory = resolvePath(
  process.env.RELAY_RENDER_OUTPUT_DIR,
  path.join(instanceRoot, "local-renders"),
);
const componentBuildWorkspaceRoot = resolvePath(
  process.env.COMPONENT_BUILD_WORKSPACE_ROOT,
  path.join(instanceRoot, "local-component-builds"),
);
const authoringWorkspaceRoot = resolvePath(
  process.env.AUTHORING_WORKSPACE_ROOT,
  path.join(instanceRoot, "local-authoring"),
);
const authoringPiSessionRoot = resolvePath(
  process.env.AUTHORING_PI_SESSION_ROOT,
  path.join(instanceRoot, "local-pi-sessions"),
);
const narrationTmpDirectory = resolvePath(
  process.env.RELAY_NARRATION_TMPDIR,
  path.join(instanceRoot, "local-narration"),
);
const authoringMode = process.env.AUTHORING_MODE ?? "fake";
const scriptRevisionMode = process.env.SCRIPT_REVISION_MODE ?? "fake";
if (!["fake", "real"].includes(authoringMode))
  throw new Error("AUTHORING_MODE must be fake or real.");
if (!["fake", "real"].includes(scriptRevisionMode))
  throw new Error("SCRIPT_REVISION_MODE must be fake or real.");
let realAuthoringEnvironment = {};
if (authoringMode === "real") {
  const authFile = await authoringAuthFile();
  const credentials = JSON.parse(await readFile(authFile, "utf8"));
  const model =
    process.env.AUTHORING_PI_MODEL ?? defaultAuthoringModel(credentials);
  const provider = model.slice(0, model.indexOf("/"));
  const credential =
    credentials[provider] ??
    (provider === "openai-codex" ? credentials.openai : undefined);
  if (!credential)
    throw new Error(
      `Pi credential provider ${provider} is unavailable in the configured auth file.`,
    );
  realAuthoringEnvironment = {
    AUTHORING_REAL_PI_ENABLED: "true",
    AUTHORING_PI_MODEL: model,
    AUTHORING_PI_CREDENTIAL_JSON: JSON.stringify(credential),
  };
}
let realScriptRevisionEnvironment = {};
if (scriptRevisionMode === "real") {
  const localKeyFile = path.resolve("kimi-api-key-code-moonshot");
  const keyFile =
    process.env.SCRIPT_REVISION_KIMI_API_KEY_FILE ??
    ((await fileExists(localKeyFile)) ? localKeyFile : undefined);
  const kimiApiKey =
    process.env.KIMI_API_KEY?.trim() ||
    (keyFile ? (await readFile(keyFile, "utf8")).trim() : "");
  const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!kimiApiKey && !openAIApiKey) {
    console.warn(
      "Real script editing is selected but unavailable until KIMI_API_KEY or OPENAI_API_KEY is configured.",
    );
  } else {
    realScriptRevisionEnvironment = {
      ...(kimiApiKey ? { KIMI_API_KEY: kimiApiKey } : {}),
      ...(openAIApiKey ? { OPENAI_API_KEY: openAIApiKey } : {}),
      SCRIPT_REVISION_PROVIDER:
        process.env.SCRIPT_REVISION_PROVIDER ??
        (kimiApiKey ? "kimi-code" : "openai"),
      SCRIPT_REVISION_MODEL:
        process.env.SCRIPT_REVISION_MODEL ??
        (kimiApiKey ? "k3-256k" : "gpt-5.6"),
    };
  }
}
if (
  process.env.NARRATION_ALIGNMENT_MODE === "openai" &&
  !process.env.NARRATION_OPENAI_API_KEY?.trim() &&
  !process.env.OPENAI_API_KEY?.trim()
) {
  console.warn(
    "Real narration alignment is selected but unavailable until NARRATION_OPENAI_API_KEY or OPENAI_API_KEY is configured.",
  );
}

const child = spawn("npm", ["run", "dev", "--workspace", "@relay/worker"], {
  stdio: "inherit",
  env: {
    ...process.env,
    RELAY_ENV: "development",
    WORKER_PORT: workerPort,
    RELAY_WORKER_AUTH_TOKEN: workerAuthToken,
    RELAY_RENDER_OUTPUT_DIR: renderOutputDirectory,
    COMPONENT_BUILD_ENABLED: "true",
    COMPONENT_BUILD_CONVEX_URL: process.env.COMPONENT_BUILD_CONVEX_URL,
    COMPONENT_BUILD_WORKER_TOKEN: process.env.COMPONENT_BUILD_WORKER_TOKEN,
    COMPONENT_BUILD_WORKSPACE_ROOT: componentBuildWorkspaceRoot,
    AUTHORING_ENABLED: "true",
    AUTHORING_MODE: authoringMode,
    SCRIPT_REVISION_MODE: scriptRevisionMode,
    AUTHORING_CONVEX_URL: process.env.AUTHORING_CONVEX_URL,
    AUTHORING_WORKER_TOKEN: process.env.AUTHORING_WORKER_TOKEN,
    AUTHORING_WORKSPACE_ROOT: authoringWorkspaceRoot,
    AUTHORING_PI_SESSION_ROOT: authoringPiSessionRoot,
    COMPONENT_LOOP_ENABLED: "true",
    COMPONENT_LOOP_WORKER_TOKEN: process.env.COMPONENT_LOOP_WORKER_TOKEN,
    NARRATION_ENABLED: "true",
    NARRATION_CONVEX_URL: process.env.NARRATION_CONVEX_URL,
    NARRATION_WORKER_TOKEN: process.env.NARRATION_WORKER_TOKEN,
    RELAY_NARRATION_TMPDIR: narrationTmpDirectory,
    NARRATION_ALIGNMENT_MODE: process.env.NARRATION_ALIGNMENT_MODE ?? "fake",
    NARRATION_OPENAI_API_KEY:
      process.env.NARRATION_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
    ...realAuthoringEnvironment,
    ...realScriptRevisionEnvironment,
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
process.exitCode = await new Promise((resolve) => {
  child.on("exit", (code) => resolve(code ?? 1));
});

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(value, fallback) {
  return path.resolve(value ?? fallback);
}

async function authoringAuthFile() {
  if (process.env.AUTHORING_PI_AUTH_FILE) {
    return process.env.AUTHORING_PI_AUTH_FILE;
  }
  for (const candidate of [
    path.join(os.homedir(), ".pi", "agent", "auth.json"),
    path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
  ]) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(
    "Real authoring requires AUTHORING_PI_AUTH_FILE or a supported local Pi/OpenCode auth file.",
  );
}

function defaultAuthoringModel(credentials) {
  if (credentials["openai-codex"] || credentials.openai)
    return "openai-codex/gpt-5.6-sol";
  if (credentials["github-copilot"]) return "github-copilot/gpt-5.6-sol";
  throw new Error(
    "Real authoring requires an OpenAI Codex, OpenAI, or GitHub Copilot credential.",
  );
}
