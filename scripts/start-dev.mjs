import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.argv.length > 2) {
  throw new Error("Usage: node scripts/start-dev.mjs");
}

const requiredNodeMajor = 24;
const currentNodeMajor = Number.parseInt(process.versions.node, 10);
if (process.env.RELAY_DEV_CELL !== "true") {
  for (const envFile of [
    path.join(os.homedir(), ".config", "relay-worker", "development.env"),
    path.join(os.homedir(), ".config", "relay", "development.env"),
  ]) {
    try {
      await access(envFile);
      process.loadEnvFile(envFile);
    } catch {
      // Each file is optional here; required values are checked below.
    }
  }
}

const localWorkerPort = process.env.RELAY_LOCAL_WORKER_PORT ?? "3213";
const localWorkerAuthToken =
  process.env.RELAY_LOCAL_WORKER_AUTH_TOKEN ??
  process.env.RELAY_WORKER_AUTH_TOKEN ??
  "relay-local-worker";
const webPort = process.env.RELAY_WEB_PORT ?? process.env.PORT ?? "3000";
const nextDistDir = process.env.NEXT_DIST_DIR ?? ".next-dev";

for (const name of ["PROJECTS_CONVEX_URL", "PROJECTS_SERVER_TOKEN"]) {
  if (!process.env[name]?.trim()) {
    throw new Error(
      `${name} is required in ~/.config/relay/development.env for npm run dev.`,
    );
  }
}
const developmentEnvironment = {
  ...process.env,
  RELAY_ENV: "development",
  RELAY_WEB_PORT: webPort,
  PORT: webPort,
  NEXT_DIST_DIR: nextDistDir,
  RELAY_LOCAL_WORKER_PORT: localWorkerPort,
  RELAY_WORKER_URL: `http://127.0.0.1:${localWorkerPort}`,
  RELAY_WORKER_AUTH_TOKEN: localWorkerAuthToken,
};

const child =
  currentNodeMajor >= requiredNodeMajor
    ? spawn("npm", ["run", "dev:stack"], {
        stdio: "inherit",
        env: developmentEnvironment,
      })
    : spawn(
        "fnm",
        ["exec", "--using", ".node-version", "npm", "run", "dev:stack"],
        {
          stdio: "inherit",
          env: developmentEnvironment,
        },
      );

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  if (
    currentNodeMajor < requiredNodeMajor &&
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    console.error(
      `Relay requires Node ${requiredNodeMajor} or newer. Install it or make fnm available in PATH.`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
}
