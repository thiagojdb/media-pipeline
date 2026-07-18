import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { CandidateExecutionResult, CandidateExecutor } from "./types.js";

const MAX_LOG_BYTES = 64_000;
const WALL_TIME_MS = 20_000;

export class IsolatedCandidateExecutor implements CandidateExecutor {
  async execute(
    workspace: string,
    signal: AbortSignal,
  ): Promise<CandidateExecutionResult> {
    try {
      await requireExecutable("/usr/bin/bwrap");
      await requireExecutable("/usr/bin/prlimit");
    } catch (error) {
      return result("crashed", "isolation_unavailable", safeMessage(error));
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
      "/workspace/validate.mjs",
    ];
    return executeBounded("/usr/bin/prlimit", args, signal);
  }
}

export function createFakeCandidateExecutor(): CandidateExecutor {
  return {
    async execute(workspace, signal) {
      const source = await import("node:fs/promises").then(({ readFile }) =>
        readFile(`${workspace}/candidate-source.tsx`, "utf8"),
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
        );
      return result(
        "succeeded",
        "validated",
        "Candidate validation passed.",
        "candidate source validated\n",
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
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
function result(
  status: CandidateExecutionResult["status"],
  code: string,
  message: string,
  stdout = "",
  stderr = "",
): CandidateExecutionResult {
  return { status, code, message, stdout, stderr };
}
