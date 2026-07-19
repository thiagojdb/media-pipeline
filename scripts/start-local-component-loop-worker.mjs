import { spawn } from "node:child_process";

const convexUrl = "http://127.0.0.1:3210";
const buildToken = "relay-local-build-worker";
const authoringToken = "relay-local-authoring-worker";
const loopToken = "relay-local-component-loop";

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
    AUTHORING_MODE: "fake",
    AUTHORING_CONVEX_URL: convexUrl,
    AUTHORING_WORKER_TOKEN: authoringToken,
    COMPONENT_LOOP_ENABLED: "true",
    COMPONENT_LOOP_WORKER_TOKEN: loopToken,
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
