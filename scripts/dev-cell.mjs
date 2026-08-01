import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DEFAULT_REMENTOR_WORKSPACE = "relay-local";
const DEFAULT_REMENTOR_DOMAIN = "relay.localhost";
const DEFAULT_REMENTOR_PROXY_PORT = 18080;
const WEB_PORT_START = 3400;
const WEB_PORT_RANGE = 1_000;
const WORKER_PORT_START = 5400;
const WORKER_PORT_RANGE = 1_000;
const STARTUP_TIMEOUT_MS = 120_000;

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

if (options.action === "cleanup") {
  await cleanupRoute(options);
  process.exit(0);
}

const instanceId = requireInstanceId(options.instanceId);
const workspace = requireRementorWorkspace(
  options.workspace ?? DEFAULT_REMENTOR_WORKSPACE,
);
const domain =
  options.domain ??
  `relay-${instanceId}.${DEFAULT_REMENTOR_DOMAIN.replace(/^relay\./, "")}`;
const rementorProxyPort = Number(
  process.env.REMENTOR_PROXY_PORT ?? DEFAULT_REMENTOR_PROXY_PORT,
);
if (
  !Number.isInteger(rementorProxyPort) ||
  rementorProxyPort < 1 ||
  rementorProxyPort > 65_535
) {
  throw new Error(
    "REMENTOR_PROXY_PORT must be an integer between 1 and 65535.",
  );
}
const webPort =
  options.webPort ??
  deterministicPort(instanceId, WEB_PORT_START, WEB_PORT_RANGE);
const workerPort =
  options.workerPort ??
  deterministicPort(instanceId, WORKER_PORT_START, WORKER_PORT_RANGE);
if (webPort === workerPort) {
  throw new Error("The Relay web and worker ports must be different.");
}

await loadDevelopmentEnvironment();
requireEnvironment("PROJECTS_CONVEX_URL", "PROJECTS_SERVER_TOKEN");
await assertPortAvailable(webPort, "web");
await assertPortAvailable(workerPort, "worker");

const instanceRoot = path.resolve(
  process.env.RELAY_INSTANCE_ROOT ??
    path.join(".relay", "dev-cells", instanceId),
);
await mkdir(instanceRoot, { recursive: true });

const workerToken =
  process.env.RELAY_LOCAL_WORKER_AUTH_TOKEN ??
  process.env.RELAY_WORKER_AUTH_TOKEN ??
  `relay-cell-${instanceId}-${randomUUID()}`;
const channelSlug =
  process.env.RELAY_DEV_CHANNEL_SLUG ?? `relay-studio-${instanceId}`;
const channelName =
  process.env.RELAY_DEV_CHANNEL_NAME ?? `Relay Studio (${instanceId})`;
const userSubject =
  process.env.RELAY_DEV_USER_SUBJECT ?? `relay-dev-user-${instanceId}`;
const nextDistDir = process.env.NEXT_DIST_DIR ?? `.next-dev-${instanceId}`;
const childEnvironment = {
  ...process.env,
  RELAY_DEV_CELL: "true",
  RELAY_INSTANCE_ID: instanceId,
  RELAY_INSTANCE_ROOT: instanceRoot,
  RELAY_DEV_HOSTNAME: domain,
  RELAY_WEB_PORT: String(webPort),
  PORT: String(webPort),
  NEXT_DIST_DIR: nextDistDir,
  RELAY_LOCAL_WORKER_PORT: String(workerPort),
  RELAY_LOCAL_WORKER_AUTH_TOKEN: workerToken,
  RELAY_WORKER_URL: `http://127.0.0.1:${workerPort}`,
  RELAY_WORKER_AUTH_TOKEN: workerToken,
  RELAY_COMPONENT_PREVIEW_ORIGIN: `http://127.0.0.1:${workerPort}`,
  RELAY_DEV_CHANNEL_SLUG: channelSlug,
  RELAY_DEV_CHANNEL_NAME: channelName,
  RELAY_DEV_USER_SUBJECT: userSubject,
};

await ensureRementorWorkspace(workspace);

const mode = options.mode ?? "fake";
const child = spawn("npm", ["run", mode === "real" ? "dev" : "dev:fake"], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: "inherit",
});
let routeRegistered = false;
let shutdownSignal;
const onSignal = (signal) => {
  shutdownSignal = signal;
  if (child.exitCode === null && !child.killed) child.kill(signal);
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

const childExit = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

try {
  await waitForHttp(`http://127.0.0.1:${webPort}/projects`, childExit);
  await announceRementorRoute({
    workspace,
    app: `relay-${instanceId}`,
    domain,
    port: webPort,
  });
  routeRegistered = true;
  console.log("");
  console.log(`Relay development cell: ${instanceId}`);
  console.log(`Web:    ${formatRementorUrl(domain, rementorProxyPort)}`);
  console.log(`Direct: http://127.0.0.1:${webPort}`);
  console.log(`Worker: http://127.0.0.1:${workerPort}/health`);
  console.log(`Mode:   ${mode}`);
  console.log(`Data:   ${process.env.PROJECTS_CONVEX_URL}`);
  console.log("");

  const result = await childExit;
  if (result.code !== 0 && result.code !== null) {
    process.exitCode = result.code;
  } else if (result.signal && !shutdownSignal) {
    process.exitCode = 1;
  }
} catch (error) {
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  await childExit.catch(() => undefined);
  throw error;
} finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  if (routeRegistered) {
    const removed = await unregisterRementorRoute(
      workspace,
      `relay-${instanceId}`,
    );
    if (!removed && process.exitCode === undefined) process.exitCode = 1;
  }
}

async function cleanupRoute({
  instanceId: requestedInstanceId,
  workspace: requestedWorkspace,
}) {
  const cleanInstanceId = requireInstanceId(requestedInstanceId);
  const cleanWorkspace = requireRementorWorkspace(
    requestedWorkspace ?? DEFAULT_REMENTOR_WORKSPACE,
  );
  const removed = await unregisterRementorRoute(
    cleanWorkspace,
    `relay-${cleanInstanceId}`,
  );
  if (!removed) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `Removed Rementor route relay-${cleanInstanceId} from ${cleanWorkspace}.`,
  );
}

async function ensureRementorWorkspace(workspaceId) {
  const workspaces = await runRementor(["--json", "workspace", "list"]);
  if (!Array.isArray(workspaces)) {
    throw new Error("Rementor returned an invalid workspace list.");
  }
  const existing = workspaces.find((item) => item.id === workspaceId);
  if (existing) {
    if (existing.type !== "local-apps") {
      throw new Error(
        `Rementor workspace ${workspaceId} already exists as ${existing.type}; expected local-apps.`,
      );
    }
    return;
  }
  try {
    await runRementor([
      "workspace",
      "create",
      workspaceId,
      "--local-domain",
      DEFAULT_REMENTOR_DOMAIN,
      "--type",
      "local-apps",
      "--name",
      "Relay local development",
    ]);
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      return;
    }
    throw error;
  }
}

async function announceRementorRoute({ workspace, app, domain, port }) {
  await runRementor([
    "announce",
    "--workspace",
    workspace,
    "--app",
    app,
    "--port",
    String(port),
    "--type",
    "local-apps",
    "--domain",
    domain,
    "--health",
    "/projects",
    "--name",
    `Relay ${app}`,
  ]);
}

async function unregisterRementorRoute(workspace, app) {
  try {
    await runRementor(["app", "unregister", workspace, app]);
    return true;
  } catch (error) {
    console.error(
      `Could not remove Rementor route ${app} from ${workspace}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function runRementor(args, { allowFailure = false } = {}) {
  const command = process.env.REMENTORCTL ?? "rementorctl";
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1_000_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (allowFailure) {
            resolve(undefined);
            return;
          }
          const detail = stderr.trim() || error.message;
          reject(
            new Error(`Rementor command failed (${args.join(" ")}): ${detail}`),
          );
          return;
        }
        const output = stdout.trim();
        if (!output) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(output));
        } catch {
          resolve(output);
        }
      },
    );
  });
}

async function loadDevelopmentEnvironment() {
  if (process.env.RELAY_DEV_CELL === "true") return;
  for (const envFile of [
    path.join(os.homedir(), ".config", "relay-worker", "development.env"),
    path.join(os.homedir(), ".config", "relay", "development.env"),
    path.resolve(".env.local"),
  ]) {
    try {
      await access(envFile);
      process.loadEnvFile(envFile);
    } catch {
      // Environment files are optional; validation below reports missing values.
    }
  }
}

function requireEnvironment(...names) {
  for (const name of names) {
    if (!process.env[name]?.trim()) {
      throw new Error(
        `${name} is required. Configure the cell environment before starting it.`,
      );
    }
  }
}

async function assertPortAvailable(port, label) {
  const available = await isPortAvailable(port);
  if (!available) {
    throw new Error(
      `The ${label} port ${port} is already in use. Pass --${label}-port with a free port.`,
    );
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForHttp(url, childExit) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const childResult = await Promise.race([
      childExit.then((result) => ({ type: "child", result })),
      new Promise((resolve) =>
        setTimeout(() => resolve({ type: "tick" }), 250),
      ),
    ]);
    if (childResult.type === "child") {
      throw new Error(
        `Relay development process exited before the web server became ready (${formatExit(childResult.result)}).`,
      );
    }
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(1_000, remainingMs)),
      });
      if (response.status < 500) return;
    } catch {
      // The web process may still be compiling or binding its port.
    }
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function formatExit({ code, signal }) {
  return signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
}

function deterministicPort(instanceId, start, range) {
  const digest = createHash("sha256").update(instanceId).digest();
  const value = digest.readUInt32BE(0) % range;
  return start + value;
}

function formatRementorUrl(domain, port) {
  return `http://${domain}${port === 80 ? "" : `:${port}`}`;
}

function requireInstanceId(value) {
  if (!value || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(value)) {
    throw new Error(
      "Instance id must contain lowercase letters, numbers, and hyphens (max 50 characters).",
    );
  }
  return value;
}

function requireRementorWorkspace(value) {
  if (value !== DEFAULT_REMENTOR_WORKSPACE) {
    throw new Error(
      `Parallel development cells may use only the ${DEFAULT_REMENTOR_WORKSPACE} Rementor workspace.`,
    );
  }
  return value;
}

function parseArguments(argv) {
  const result = {
    action: "start",
    instanceId: undefined,
    mode: undefined,
    webPort: undefined,
    workerPort: undefined,
    workspace: undefined,
    domain: undefined,
    help: false,
  };
  let index = 0;
  if (argv[0] === "start" || argv[0] === "cleanup") {
    result.action = argv[0];
    index = 1;
  }
  if (argv[index] && !argv[index].startsWith("-")) {
    result.instanceId = argv[index];
    index += 1;
  }
  while (index < argv.length) {
    const argument = argv[index++];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    const [flag, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? argv[index++];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    if (flag === "--mode") result.mode = value;
    else if (flag === "--web-port") result.webPort = parsePort(value, flag);
    else if (flag === "--worker-port")
      result.workerPort = parsePort(value, flag);
    else if (flag === "--workspace") result.workspace = value;
    else if (flag === "--domain") result.domain = value;
    else throw new Error(`Unknown option ${flag}.`);
  }
  if (result.mode && !["fake", "real"].includes(result.mode)) {
    throw new Error("--mode must be fake or real.");
  }
  return result;
}

function parsePort(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${flag} must be an integer between 1 and 65535.`);
  }
  return port;
}

function printUsage() {
  console.log(`Relay development cells

Usage:
  npm run dev:cell -- <instance> [options]
  npm run dev:cell -- start <instance> [options]
  npm run dev:cell -- cleanup <instance> [--workspace <id>]

Options:
  --mode fake|real       Provider mode (default: fake)
  --web-port <port>      Override the deterministic web port
  --worker-port <port>   Override the deterministic worker port
  --workspace <id>       Rementor workspace (default: relay-local)
  --domain <hostname>    Rementor hostname (default: relay-<instance>.localhost)
  --help                 Show this help

The cell inherits the configured Convex environment. Use a separate Convex
deployment and server tokens when the cell must not share data or queues.
`);
}
