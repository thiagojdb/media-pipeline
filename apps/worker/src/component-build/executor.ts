import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateComponentSource } from "@relay/component-testkit";
import { build } from "esbuild";

import type {
  CandidateExecutionResult,
  CandidateExecutor,
  ValidationCheck,
  ValidationEvidence,
} from "./types.js";

const MAX_LOG_BYTES = 64_000;
const WALL_TIME_MS = 20_000;

export class IsolatedCandidateExecutor implements CandidateExecutor {
  constructor(private readonly probe?: "isolation" | "crash") {}

  async execute(
    workspace: string,
    signal: AbortSignal,
  ): Promise<CandidateExecutionResult> {
    const source = await readFile(
      path.join(workspace, "candidate-source.tsx"),
      "utf8",
    );
    const policy = validateComponentSource({ "candidate-source.tsx": source });
    if (!policy.success) {
      const details = policy.issues.map(
        (issue) =>
          `${issue.file}:${issue.line} [${issue.code}] ${issue.message}`,
      );
      return result(
        "failed",
        "source_policy_failed",
        "Candidate source violates Relay's deterministic source policy.",
        "",
        details.join("\n"),
        evidence([
          failed(
            "source_policy",
            "Candidate source violates Relay's deterministic source policy.",
            details,
          ),
        ]),
      );
    }

    let preflight = evidence([
      passed(
        "source_policy",
        "Candidate source passed the deterministic source-policy check.",
      ),
    ]);
    try {
      if (this.probe === "isolation") {
        await writeFile(
          path.join(workspace, "validator-bundle.cjs"),
          isolationProbeBundle,
        );
      } else if (this.probe === "crash") {
        await writeFile(
          path.join(workspace, "validator-bundle.cjs"),
          "process.abort();\n",
        );
      } else {
        await build({
          entryPoints: [path.join(workspace, "validate.mjs")],
          outfile: path.join(workspace, "validator-bundle.cjs"),
          absWorkingDir: process.cwd(),
          bundle: true,
          format: "cjs",
          platform: "node",
          target: "node24",
          jsx: "automatic",
          logLevel: "silent",
          nodePaths: [path.resolve("node_modules")],
        });
      }
      preflight = evidence([
        ...preflight.checks,
        passed(
          "typescript_bundle",
          "Candidate TypeScript compiled with only declared dependencies.",
        ),
      ]);
    } catch (error) {
      const detail = safeMessage(error);
      return result(
        "failed",
        "typescript_bundle_failed",
        "Candidate TypeScript did not compile with the allowed dependency set.",
        "",
        detail,
        evidence([
          ...preflight.checks,
          failed(
            "typescript_bundle",
            "Candidate TypeScript did not compile with the allowed dependency set.",
            [detail],
          ),
        ]),
      );
    }

    try {
      await requireExecutable("/usr/bin/bwrap");
      await requireExecutable("/usr/bin/prlimit");
    } catch (error) {
      return result(
        "crashed",
        "isolation_unavailable",
        safeMessage(error),
        "",
        "",
        preflight,
      );
    }
    const args = [
      "--as=2147483648",
      "--cpu=30",
      "--fsize=5242880",
      "--nofile=64",
      "--",
      "/usr/bin/bwrap",
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--clearenv",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--ro-bind",
      workspace,
      "/workspace",
      "--chdir",
      "/workspace",
      "--setenv",
      "HOME",
      "/nonexistent",
      "--setenv",
      "PATH",
      "/usr/bin",
      "/usr/bin/prlimit",
      "--nproc=32",
      "--",
      "/usr/bin/node",
      "/workspace/validator-bundle.cjs",
    ];
    const execution = await executeBounded("/usr/bin/prlimit", args, signal);
    const runtime = parseEvidence(execution.stdout);
    const combined = runtime
      ? { ...runtime, checks: [...preflight.checks, ...runtime.checks] }
      : execution.status === "failed"
        ? evidence([
            ...preflight.checks,
            failed(
              "component_contract",
              "Candidate failed while loading the component contract.",
              [safeRuntimeDetail(execution.stderr)],
            ),
          ])
        : preflight;
    return {
      ...execution,
      validationEvidence: combined,
    };
  }
}

export function createFakeCandidateExecutor(): CandidateExecutor {
  return {
    async execute(workspace, signal) {
      const source = await readFile(
        `${workspace}/candidate-source.tsx`,
        "utf8",
      );
      if (signal.aborted || source.includes("FIXTURE_CANCEL"))
        return result(
          "canceled",
          "build_canceled",
          "Candidate build canceled.",
        );
      if (source.includes("FIXTURE_TIMEOUT"))
        return result(
          "timed_out",
          "build_timeout",
          "Candidate exceeded its wall-time limit.",
        );
      if (source.includes("FIXTURE_CRASH"))
        return result("crashed", "build_crashed", "Candidate process crashed.");
      if (source.includes("FIXTURE_INVALID"))
        return result(
          "failed",
          "validation_failed",
          "Candidate validation failed.",
          "",
          "candidate-source.tsx: invalid fixture",
          evidence([
            passed("source_policy", "Source policy passed."),
            passed("typescript_bundle", "TypeScript bundle passed."),
            failed("fixture_inputs", "Fixture input validation failed.", [
              "candidate-source.tsx: invalid fixture",
            ]),
          ]),
        );
      return result(
        "succeeded",
        "validated",
        "Candidate validation passed.",
        "candidate source validated\n",
        "",
        evidence(
          [
            passed("source_policy", "Source policy passed."),
            passed("typescript_bundle", "TypeScript bundle passed."),
            passed("component_contract", "Component contract passed."),
            passed("fixture_inputs", "Fixture inputs passed."),
            passed("checkpoint_runtime", "Checkpoint runtime passed."),
            passed("preview_runtime", "Full preview runtime passed."),
          ],
          1,
          1,
          30,
          "a".repeat(64),
        ),
      );
    },
  };
}

async function executeBounded(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<CandidateExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let logExceeded = false;
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > MAX_LOG_BYTES) {
        logExceeded = true;
        return Buffer.from(next).subarray(0, MAX_LOG_BYTES).toString("utf8");
      }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
      if (logExceeded) terminate(child.pid);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
      if (logExceeded) terminate(child.pid);
    });
    const cancel = () => terminate(child.pid);
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child.pid);
    }, WALL_TIME_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      resolve(
        result(
          "crashed",
          "isolation_unavailable",
          safeMessage(error),
          stdout,
          stderr,
        ),
      );
    });
    child.on("close", (code, closeSignal) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (signal.aborted)
        resolve(
          result(
            "canceled",
            "build_canceled",
            "Candidate build canceled.",
            stdout,
            stderr,
          ),
        );
      else if (logExceeded)
        resolve(
          result(
            "failed",
            "log_limit_exceeded",
            "Candidate logs exceeded 64 KB.",
            stdout,
            stderr,
          ),
        );
      else if (timedOut)
        resolve(
          result(
            "timed_out",
            "build_timeout",
            "Candidate exceeded its wall-time limit.",
            stdout,
            stderr,
          ),
        );
      else if (stderr.startsWith("bwrap:"))
        resolve(
          result(
            "crashed",
            "isolation_unavailable",
            "Bubblewrap could not establish the required isolation boundary.",
            stdout,
            stderr,
          ),
        );
      else if (closeSignal || (code !== null && code >= 128))
        resolve(
          result(
            "crashed",
            "build_crashed",
            `Candidate validation process crashed${closeSignal ? ` with ${closeSignal}` : ` with exit code ${code}`}.`,
            stdout,
            stderr,
          ),
        );
      else if (code === 0)
        resolve(
          result(
            "succeeded",
            "validated",
            "Candidate validation passed.",
            stdout,
            stderr,
          ),
        );
      else
        resolve(
          result(
            "failed",
            "validation_failed",
            `Candidate validation exited with code ${code ?? "unknown"}.`,
            stdout,
            stderr,
          ),
        );
    });
  });
}

function terminate(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The bounded process already exited.
  }
}
async function requireExecutable(file: string): Promise<void> {
  try {
    await access(file, fsConstants.X_OK);
  } catch {
    throw new Error(
      `Required fail-closed isolation executable ${file} is unavailable.`,
    );
  }
}
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}
function result(
  status: CandidateExecutionResult["status"],
  code: string,
  message: string,
  stdout = "",
  stderr = "",
  validationEvidence = evidence([]),
): CandidateExecutionResult {
  return { status, code, message, stdout, stderr, validationEvidence };
}
function evidence(
  checks: readonly ValidationCheck[],
  fixtureCount = 0,
  checkpointCount = 0,
  renderedFrameCount = 0,
  renderFingerprint?: string,
): ValidationEvidence {
  return {
    schemaVersion: 1,
    checks,
    fixtureCount,
    checkpointCount,
    renderedFrameCount,
    renderFingerprint,
  };
}
function passed(
  code: ValidationCheck["code"],
  message: string,
): ValidationCheck {
  return { code, status: "passed", message };
}
function failed(
  code: ValidationCheck["code"],
  message: string,
  details: readonly string[],
): ValidationCheck {
  return { code, status: "failed", message, details };
}
function parseEvidence(stdout: string): ValidationEvidence | undefined {
  const line = stdout
    .split("\n")
    .find((item) => item.startsWith("RELAY_VALIDATION_EVIDENCE="));
  if (!line) return undefined;
  try {
    return JSON.parse(
      line.slice("RELAY_VALIDATION_EVIDENCE=".length),
    ) as ValidationEvidence;
  } catch {
    return undefined;
  }
}
function safeRuntimeDetail(value: string): string {
  return value
    .replaceAll(process.cwd(), "[worker]")
    .replaceAll(/\b(?:Bearer\s+\S+|sk-[a-z0-9_-]{8,})/gi, "[redacted]")
    .slice(0, 1_000);
}

const isolationProbeBundle = `
const {readdir, writeFile} = require("node:fs/promises");
(async () => {
  if (process.env.RELAY_ISOLATION_PROBE_SECRET) throw new Error("Parent environment leaked into the sandbox.");
  const rootEntries = await readdir("/");
  if (rootEntries.includes("home") || rootEntries.includes("root")) throw new Error("Host home directories are visible in the sandbox.");
  await expectFailure(() => writeFile("/workspace/sandbox-write-probe", "forbidden"));
  await writeFile("/host-write-probe", "sandbox namespace only");
  await expectFailure(() => fetch("http://1.1.1.1", {signal: AbortSignal.timeout(500)}));
  console.log("isolation probes passed");
})().catch((error) => { console.error(error.message); process.exit(2); });
async function expectFailure(operation) {
  try { await operation(); } catch { return; }
  throw new Error("Isolation probe unexpectedly succeeded.");
}
`;
