import { createHash } from "node:crypto";

import { validateComponentSource } from "@relay/component-testkit";
import ts from "typescript";

import type {
  AuthoringActivity,
  AuthoringTools,
  AuthoringTurn,
  AuthoringWorkspace,
} from "./types.js";

export class AuthoringBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringBudgetExceededError";
  }
}

export class RelayAuthoringTools implements AuthoringTools {
  #calls: number;
  #declaredReady = false;
  #budgetExceeded = false;
  #checkedHash: string | undefined;

  constructor(
    private readonly turn: AuthoringTurn,
    private readonly workspace: AuthoringWorkspace,
    private readonly signal: AbortSignal,
    private readonly record: (activity: AuthoringActivity) => Promise<void>,
  ) {
    this.#calls = turn.priorToolCalls;
  }

  get declaredReady(): boolean {
    return this.#declaredReady;
  }
  get toolCalls(): number {
    return this.#calls;
  }
  get budgetExceeded(): boolean {
    return this.#budgetExceeded;
  }

  readContext(): Promise<string> {
    return this.#invoke("read_authoring_context", "{}", async () => {
      const value = await this.workspace.readContext();
      return {
        value,
        summary: `Read ${Buffer.byteLength(value)} context bytes.`,
      };
    });
  }

  replaceCandidate(source: string): Promise<string> {
    return this.#invoke(
      "replace_candidate_source",
      JSON.stringify({ bytes: Buffer.byteLength(source) }),
      async () => {
        await this.workspace.replaceCandidate(source);
        this.#checkedHash = undefined;
        this.#declaredReady = false;
        return {
          value: "Candidate source replaced.",
          summary: `Replaced candidate with ${Buffer.byteLength(source)} bytes.`,
        };
      },
    );
  }

  checkCandidate(): Promise<string> {
    return this.#invoke("check_candidate", "{}", async () => {
      const source = await this.workspace.readCandidate();
      const syntax = ts.transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: "candidate-source.tsx",
        reportDiagnostics: true,
      });
      const syntaxErrors = (syntax.diagnostics ?? []).filter(
        ({ category }) => category === ts.DiagnosticCategory.Error,
      );
      if (syntaxErrors.length > 0) {
        throw new Error(
          syntaxErrors
            .slice(0, 10)
            .map(({ messageText }) =>
              ts.flattenDiagnosticMessageText(messageText, " "),
            )
            .join("\n"),
        );
      }
      const result = validateComponentSource({
        "candidate-source.tsx": source,
      });
      if (!result.success) {
        const summary = result.issues
          .slice(0, 10)
          .map((issue) => `${issue.code}: ${issue.message}`)
          .join("\n");
        throw new Error(summary || "Candidate source policy failed.");
      }
      this.#checkedHash = sha256(source);
      return {
        value:
          "Candidate syntax and source policy passed without executing candidate code.",
        summary: "Candidate source policy passed.",
      };
    });
  }

  declareReady(summary: string): Promise<string> {
    return this.#invoke(
      "declare_candidate_ready",
      JSON.stringify({
        summaryBytes: Buffer.byteLength(summary),
        summaryHash: sha256(summary),
      }),
      async () => {
        if (!summary.trim() || summary.length > 2_000)
          throw new Error("Candidate-ready summary must be 1-2000 characters.");
        const source = await this.workspace.readCandidate();
        if (this.#checkedHash !== sha256(source))
          throw new Error(
            "Candidate must pass check_candidate after its latest edit.",
          );
        this.#declaredReady = true;
        return {
          value:
            "Candidate declared ready for independent MED-133 validation. This is not approval.",
          summary: "Candidate readiness declared.",
        };
      },
    );
  }

  async #invoke<T>(
    name: string,
    inputSummary: string,
    operation: () => Promise<{ value: T; summary: string }>,
  ): Promise<T> {
    if (this.signal.aborted) throw new Error("Authoring turn canceled.");
    if (this.#calls >= this.turn.maxToolCalls) {
      this.#budgetExceeded = true;
      await this.record({
        sequence: Math.max(1, this.#calls),
        name,
        status: "blocked_budget",
        inputSummary: "Tool call blocked before execution.",
        outputSummary: "Authoring tool-call budget exhausted.",
        durationMs: 0,
      }).catch(() => undefined);
      throw new AuthoringBudgetExceededError(
        "Authoring tool-call budget exhausted.",
      );
    }
    this.#calls += 1;
    const started = Date.now();
    try {
      const result = await operation();
      await this.record({
        sequence: this.#calls,
        name,
        status: "succeeded",
        inputSummary: truncate(inputSummary, 1_000),
        outputSummary: truncate(result.summary, 1_000),
        durationMs: Date.now() - started,
      });
      return result.value;
    } catch (error) {
      await this.record({
        sequence: this.#calls,
        name,
        status: "failed",
        inputSummary: truncate(inputSummary, 1_000),
        outputSummary: truncate(
          error instanceof Error ? error.message : String(error),
          1_000,
        ),
        durationMs: Date.now() - started,
      }).catch(() => undefined);
      throw error;
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
