import { spawn } from "node:child_process";

const mode = process.argv[2];
if (mode !== "real" && mode !== "fake") {
  throw new Error("Usage: node scripts/start-dev.mjs <real|fake>");
}

const requiredNodeMajor = 24;
const currentNodeMajor = Number.parseInt(process.versions.node, 10);
const stackScript = mode === "real" ? "dev:stack:real" : "dev:stack:fake";
const localWorkerPort = process.env.RELAY_LOCAL_WORKER_PORT ?? "3213";
const localWorkerAuthToken =
  process.env.RELAY_LOCAL_WORKER_AUTH_TOKEN ?? "relay-local-worker";
const developmentApiOrigin =
  process.env.RELAY_DEVELOPMENT_API_ORIGIN ??
  "https://relay-blush-sigma.vercel.app";
const developmentEnvironment = {
  ...process.env,
  RELAY_ENV: "development",
  RELAY_DEVELOPMENT_API_ORIGIN: developmentApiOrigin,
  RELAY_LOCAL_WORKER_PORT: localWorkerPort,
  RELAY_WORKER_URL: `http://127.0.0.1:${localWorkerPort}`,
  RELAY_WORKER_AUTH_TOKEN: localWorkerAuthToken,
};

const child =
  currentNodeMajor >= requiredNodeMajor
    ? spawn("npm", ["run", stackScript], {
        stdio: "inherit",
        env: developmentEnvironment,
      })
    : spawn(
        "fnm",
        [
          "exec",
          "--using",
          String(requiredNodeMajor),
          "npm",
          "run",
          stackScript,
        ],
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
