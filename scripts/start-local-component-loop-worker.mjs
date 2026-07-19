import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const convexUrl = "http://127.0.0.1:3210";
const buildToken = "relay-local-build-worker";
const authoringToken = "relay-local-authoring-worker";
const loopToken = "relay-local-component-loop";
const authoringMode = process.env.AUTHORING_MODE ?? "fake";
if (!["fake", "real"].includes(authoringMode))
  throw new Error("AUTHORING_MODE must be fake or real.");
let realAuthoringEnvironment = {};
if (authoringMode === "real") {
  const model = process.env.AUTHORING_PI_MODEL ?? "openai-codex/gpt-5.4-mini";
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

await waitForConvex();
for (const [name, value] of [
  ["COMPONENT_BUILD_WORKER_TOKEN", buildToken],
  ["AUTHORING_WORKER_TOKEN", authoringToken],
  ["COMPONENT_LOOP_WORKER_TOKEN", loopToken],
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
    AUTHORING_CONVEX_URL: convexUrl,
    AUTHORING_WORKER_TOKEN: authoringToken,
    COMPONENT_LOOP_ENABLED: "true",
    COMPONENT_LOOP_WORKER_TOKEN: loopToken,
    ...realAuthoringEnvironment,
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
