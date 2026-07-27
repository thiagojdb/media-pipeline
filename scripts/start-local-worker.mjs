import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const convexUrl = "http://127.0.0.1:3210";
const buildToken = "relay-local-build-worker";
const authoringToken = "relay-local-authoring-worker";
const loopToken = "relay-local-component-loop";
const projectsToken = "relay-local-projects";
const narrationToken = "relay-local-narration";
const authoringMode = process.env.AUTHORING_MODE ?? "fake";
const scriptRevisionMode = process.env.SCRIPT_REVISION_MODE ?? "real";
if (!["fake", "real"].includes(authoringMode))
  throw new Error("AUTHORING_MODE must be fake or real.");
if (!["fake", "real"].includes(scriptRevisionMode))
  throw new Error("SCRIPT_REVISION_MODE must be fake or real.");
let realAuthoringEnvironment = {};
if (authoringMode === "real") {
  const model = process.env.AUTHORING_PI_MODEL ?? "openai-codex/gpt-5.6-sol";
  const provider = model.slice(0, model.indexOf("/"));
  const authFile =
    process.env.AUTHORING_PI_AUTH_FILE ??
    path.join(os.homedir(), ".pi", "codex-tuta", "auth.json");
  const credentials = JSON.parse(await readFile(authFile, "utf8"));
  const credential = credentials[provider];
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
  if (!kimiApiKey && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "Real script editing requires KIMI_API_KEY, SCRIPT_REVISION_KIMI_API_KEY_FILE, or OPENAI_API_KEY.",
    );
  }
  realScriptRevisionEnvironment = {
    ...(kimiApiKey ? { KIMI_API_KEY: kimiApiKey } : {}),
    SCRIPT_REVISION_PROVIDER:
      process.env.SCRIPT_REVISION_PROVIDER ??
      (kimiApiKey ? "kimi-code" : "openai"),
    SCRIPT_REVISION_MODEL:
      process.env.SCRIPT_REVISION_MODEL ?? (kimiApiKey ? "k3-256k" : "gpt-5.6"),
  };
}

await waitForConvex();
for (const [name, value] of [
  ["COMPONENT_BUILD_WORKER_TOKEN", buildToken],
  ["AUTHORING_WORKER_TOKEN", authoringToken],
  ["COMPONENT_LOOP_WORKER_TOKEN", loopToken],
  ["PROJECTS_SERVER_TOKEN", projectsToken],
  ["NARRATION_WORKER_TOKEN", narrationToken],
]) {
  await run("npx", [
    "convex",
    "env",
    "set",
    "--deployment",
    "local",
    name,
    value,
  ]);
}

const child = spawn("npm", ["run", "dev", "--workspace", "@relay/worker"], {
  stdio: "inherit",
  env: {
    ...process.env,
    COMPONENT_BUILD_ENABLED: "true",
    COMPONENT_BUILD_CONVEX_URL: convexUrl,
    COMPONENT_BUILD_WORKER_TOKEN: buildToken,
    AUTHORING_ENABLED: "true",
    AUTHORING_MODE: authoringMode,
    SCRIPT_REVISION_MODE: scriptRevisionMode,
    AUTHORING_CONVEX_URL: convexUrl,
    AUTHORING_WORKER_TOKEN: authoringToken,
    COMPONENT_LOOP_ENABLED: "true",
    COMPONENT_LOOP_WORKER_TOKEN: loopToken,
    NARRATION_ENABLED: "true",
    NARRATION_CONVEX_URL: convexUrl,
    NARRATION_WORKER_TOKEN: narrationToken,
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

async function waitForConvex() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fetch(convexUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Local Convex did not become ready within 120 seconds.");
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}
