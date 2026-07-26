import { expect, test } from "@playwright/test";

test("creates, opens, renames, and archives a channel project through real routes", async ({
  page,
}) => {
  const channel = {
    id: "channel-relay",
    slug: "relay-studio",
    name: "Relay Studio",
  };
  let project:
    | {
        _id: string;
        name: string;
        description?: string;
        status: "active" | "archived";
        createdAt: number;
        updatedAt: number;
        archivedAt?: number;
      }
    | undefined;
  let sources: Array<{
    _id: string;
    kind: "url" | "file";
    title: string;
    normalizedUrl?: string;
    fileName?: string;
    mediaType: string;
    byteSize: number;
    contentHash: string;
    createdAt: number;
    downloadUrl?: string;
  }> = [];
  let uploadAttempts = 0;
  const scriptVersions: Array<{
    _id: string;
    projectId: string;
    version: number;
    content: string;
    provenance: "manual" | "import";
    createdAt: number;
  }> = [];
  type MockNarrationVersion = {
    _id: string;
    projectId: string;
    scriptVersionId?: string;
    version: number;
    provenance: "generated" | "upload";
    mediaType: string;
    audioUrl: string;
    durationMs: number;
    timingSegments: Array<{
      index: number;
      startMs: number;
      endMs: number;
      text: string;
    }>;
    provider: string;
    model: string;
    fileName?: string;
    audioCodec?: string;
    sampleRate?: number;
    channels?: number;
    usageCharacters?: number;
    estimatedCostUsd?: number;
    wallTimeMs: number;
    createdAt: number;
  };
  const narrationVersions: MockNarrationVersion[] = [];
  let narrationJob:
    | {
        _id: string;
        kind: "generated" | "upload";
        scriptVersionId?: string;
        state: "queued" | "succeeded";
        cancelRequested: false;
        provider: string;
        model: string;
        terminalMessage?: string;
        createdAt: number;
      }
    | undefined;
  let narrationPolls = 0;
  let narrationUploadCount = 0;
  let pendingNarrationFileName = "";
  let beats: Array<{
    _id: string;
    narrationVersionId: string;
    order: number;
    startMs: number;
    endMs: number;
    title: string;
    summary?: string;
  }> = [];
  let compositionVersion = 0;
  let composition:
    | {
        schemaVersion: 1;
        narrationVersionId: string;
        fps: number;
        width: number;
        height: number;
        segments: Array<{
          id: string;
          kind: "component";
          componentVersionId: string;
          input: unknown;
          anchor: {
            kind: "beat";
            beatId: string;
            startMs: number;
            endMs: number;
          };
        }>;
      }
    | undefined;
  type MockProposal = {
    _id: string;
    request: string;
    state: "reviewable" | "invalid" | "accepted" | "rejected";
    rationale: string;
    patchJson?: string;
    validationEvidenceJson: string;
    toolActivityJson: string;
    provider: string;
    model: string;
    attempt: number;
    maxAttempts: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    acceptedCompositionVersionId?: string;
    createdAt: number;
    proposedComposition?: NonNullable<typeof composition>;
  };
  let proposals: MockProposal[] = [];
  type MockProjectRender = {
    _id: string;
    rangeKind: "full" | "selection";
    rangeStartMs: number;
    rangeEndMs: number;
    width: number;
    height: number;
    fps: number;
    state: "queued" | "running" | "succeeded" | "canceled";
    progress: number;
    attempt: number;
    maxAttempts: number;
    cancelRequested: boolean;
    outputUrl?: string;
    outputSizeBytes?: number;
    wallTimeMs?: number;
    terminalMessage?: string;
    createdAt: number;
    updatedAt: number;
  };
  let projectRenders: MockProjectRender[] = [];
  let projectRenderPolls = 0;

  await page
    .context()
    .route("**/api/component-loop/library**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/component-loop/library") {
        await route.fulfill({
          status: 200,
          json: [
            {
              id: "component-result-card",
              componentId: "result-card",
              latestVersion: {
                id: "approved-result-card-v1",
                version: "1.0.0",
              },
            },
            {
              id: "component-line-chart",
              componentId: "animated-line-chart",
              latestVersion: {
                id: "approved-line-chart-v1",
                version: "1.0.0",
              },
            },
          ],
        });
        return;
      }
      await route.fulfill({
        status: 200,
        json: {
          componentId: "result-card",
          latestApprovedVersionId: "approved-result-card-v1",
          versions: [
            {
              id: "approved-result-card-v1",
              version: "1.0.0",
              inputSchemaJson: JSON.stringify({
                type: "object",
                properties: {
                  title: { type: "string", title: "Card title" },
                  score: { type: "number", title: "Result score" },
                },
                required: ["title", "score"],
              }),
              fixtures: [{ input: { title: "Election result", score: 51 } }],
            },
          ],
        },
      });
    });
  await page
    .context()
    .route("**/api/component-loop/versions/**/preview**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><body data-frame="0"><script>
          window.addEventListener("message", (event) => {
            if (event.data?.type === "relay-preview-frame-v1") {
              document.body.dataset.frame = String(event.data.frame);
            }
          });
        </script></body>`,
      });
    });

  await page.context().route("https://upload.test/source", async (route) => {
    expect(route.request().method()).toBe("POST");
    uploadAttempts += 1;
    if (uploadAttempts === 1) {
      await route.fulfill({
        status: 503,
        json: { message: "Storage is unavailable. Try again." },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { storageId: "storage-briefing" },
    });
  });
  await page.context().route("https://upload.test/narration", async (route) => {
    expect(route.request().method()).toBe("POST");
    narrationUploadCount += 1;
    await route.fulfill({
      status: 200,
      json: { storageId: `narration-storage-${narrationUploadCount}` },
    });
  });
  await page
    .context()
    .route("https://download.test/project-draft.mp4", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-disposition":
            'attachment; filename="relay-project-draft.mp4"',
        },
        contentType: "video/mp4",
        body: Buffer.from("mock-project-mp4"),
      });
    });

  await page.context().route("**/api/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isCollection = url.pathname === "/api/projects";

    if (request.method() === "GET" && isCollection) {
      await route.fulfill({
        status: 200,
        json: { channel, projects: project ? [project] : [] },
      });
      return;
    }
    if (request.method() === "POST" && isCollection) {
      const input = request.postDataJSON() as {
        name: string;
        description?: string;
      };
      project = {
        _id: "project-election-night",
        name: input.name,
        description: input.description,
        status: "active",
        createdAt: 100,
        updatedAt: 100,
      };
      await route.fulfill({ status: 201, json: { projectId: project._id } });
      return;
    }
    if (
      url.pathname === "/api/projects/project-election-night/sources" &&
      project
    ) {
      if (request.method() === "GET") {
        await route.fulfill({ status: 200, json: { sources } });
        return;
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON() as Record<string, unknown> & {
          action: string;
        };
        if (input.action === "add_url") {
          sources = [
            {
              _id: "source-results",
              kind: "url",
              title: String(input.title),
              normalizedUrl: String(input.url),
              mediaType: "text/html",
              byteSize: 0,
              contentHash: "a".repeat(64),
              createdAt: 150,
            },
            ...sources,
          ];
          await route.fulfill({
            status: 201,
            json: { sourceId: "source-results" },
          });
          return;
        }
        if (input.action === "prepare_file") {
          await route.fulfill({
            status: 200,
            json: {
              uploadUrl: "https://upload.test/source",
              maximumBytes: 26_214_400,
            },
          });
          return;
        }
        if (input.action === "finalize_file") {
          sources = [
            {
              _id: "source-briefing",
              kind: "file",
              title: String(input.title),
              fileName: String(input.fileName),
              mediaType: String(input.mediaType),
              byteSize: 17,
              contentHash: "b".repeat(64),
              createdAt: 175,
              downloadUrl: "https://download.test/briefing.txt",
            },
            ...sources,
          ];
          await route.fulfill({
            status: 201,
            json: { sourceId: "source-briefing" },
          });
          return;
        }
        if (input.action === "remove") {
          sources = sources.filter((source) => source._id !== input.sourceId);
          await route.fulfill({
            status: 200,
            json: { sourceId: input.sourceId },
          });
          return;
        }
      }
    }
    if (
      url.pathname === "/api/projects/project-election-night/scripts" &&
      project
    ) {
      if (request.method() === "GET") {
        const current = scriptVersions.at(-1) ?? null;
        await route.fulfill({
          status: 200,
          json: {
            current,
            versions: scriptVersions
              .toReversed()
              .map(({ content, ...version }) => ({
                ...version,
                characterCount: content.length,
                excerpt: content.replace(/\s+/g, " ").slice(0, 140),
              })),
            maximumCharacters: 100_000,
          },
        });
        return;
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON() as {
          content: string;
          provenance: "manual" | "import";
        };
        const version = scriptVersions.length + 1;
        const script = {
          _id: `script-${version}`,
          projectId: project._id,
          version,
          content: input.content,
          provenance: input.provenance,
          createdAt: 200 + version,
        };
        scriptVersions.push(script);
        await route.fulfill({
          status: 201,
          json: { scriptVersionId: script._id, version },
        });
        return;
      }
    }
    const scriptMatch = url.pathname.match(
      /^\/api\/projects\/project-election-night\/scripts\/(\d+)$/,
    );
    if (scriptMatch && request.method() === "GET" && project) {
      const script = scriptVersions.find(
        (candidate) => candidate.version === Number(scriptMatch[1]),
      );
      await route.fulfill(
        script
          ? { status: 200, json: { channel, project, script } }
          : {
              status: 404,
              json: { message: "Script version was not found." },
            },
      );
      return;
    }
    if (
      url.pathname === "/api/projects/project-election-night/narrations" &&
      project
    ) {
      if (request.method() === "POST") {
        const input = request.postDataJSON() as {
          action: "generate" | "cancel" | "prepare_upload" | "finalize_upload";
          scriptVersionId?: string;
          fileName?: string;
        };
        if (input.action === "generate") {
          narrationJob = {
            _id: "narration-job-1",
            kind: "generated",
            scriptVersionId: String(input.scriptVersionId),
            state: "queued",
            cancelRequested: false,
            provider: "relay-fake-tts",
            model: "deterministic-wave-v1",
            createdAt: 300,
          };
          narrationPolls = 0;
          await route.fulfill({
            status: 202,
            json: { jobId: narrationJob._id },
          });
          return;
        }
        if (input.action === "prepare_upload") {
          pendingNarrationFileName = String(input.fileName);
          await route.fulfill({
            status: 202,
            json: {
              uploadUrl: "https://upload.test/narration",
              maximumBytes: 100 * 1024 * 1024,
            },
          });
          return;
        }
        if (input.action === "finalize_upload") {
          narrationJob = {
            _id: `narration-job-${narrationUploadCount + 1}`,
            kind: "upload",
            state: "queued",
            cancelRequested: false,
            provider: "relay-upload",
            model: "ffprobe",
            createdAt: 400 + narrationUploadCount,
          };
          narrationPolls = 0;
          await route.fulfill({
            status: 202,
            json: { jobId: narrationJob._id },
          });
          return;
        }
      }
      if (request.method() === "GET") {
        if (narrationJob) {
          narrationPolls += 1;
          if (narrationPolls >= 2) {
            narrationJob = {
              ...narrationJob,
              state: "succeeded",
              terminalMessage:
                narrationJob.kind === "generated"
                  ? "Narration generated with timing."
                  : "Uploaded narration probed and ready.",
            };
            if (
              narrationJob.kind === "generated" &&
              !narrationVersions.some(
                (version) => version.provenance === "generated",
              )
            ) {
              narrationVersions.unshift({
                _id: "narration-version-1",
                projectId: project._id,
                scriptVersionId: narrationJob.scriptVersionId,
                version: 1,
                provenance: "generated",
                mediaType: "audio/wav",
                audioUrl: silentWavDataUrl(3_000),
                durationMs: 2_000,
                timingSegments: [
                  {
                    index: 0,
                    startMs: 0,
                    endMs: 800,
                    text: "Opening line.",
                  },
                  {
                    index: 1,
                    startMs: 800,
                    endMs: 2_000,
                    text: "The first explanation.",
                  },
                ],
                provider: "relay-fake-tts",
                model: "deterministic-wave-v1",
                usageCharacters: 38,
                estimatedCostUsd: 0,
                wallTimeMs: 10,
                createdAt: 310,
              });
            } else if (
              narrationJob.kind === "upload" &&
              !narrationVersions.some(
                (version) => version.fileName === pendingNarrationFileName,
              )
            ) {
              narrationVersions.unshift({
                _id: `narration-version-${narrationVersions.length + 1}`,
                projectId: project._id,
                version: narrationVersions.length + 1,
                provenance: "upload",
                mediaType: "audio/wav",
                audioUrl: silentWavDataUrl(3_000),
                durationMs: 2_500 + narrationUploadCount * 100,
                timingSegments: [],
                provider: "relay-upload",
                model: "ffprobe",
                fileName: pendingNarrationFileName,
                audioCodec: "pcm_s16le",
                sampleRate: 16_000,
                channels: 1,
                wallTimeMs: 12,
                createdAt: 410 + narrationUploadCount,
              });
            }
          }
        }
        await route.fulfill({
          status: 200,
          json: {
            jobs: narrationJob ? [narrationJob] : [],
            versions: narrationVersions,
          },
        });
        return;
      }
    }
    if (
      url.pathname === "/api/projects/project-election-night/beats" &&
      project
    ) {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          json: {
            currentNarrationVersionId: narrationVersions[0]?._id ?? null,
            narrationVersions: narrationVersions.map(
              ({ _id, version, durationMs }) => ({
                _id,
                version,
                durationMs,
              }),
            ),
            beats,
          },
        });
        return;
      }
      if (request.method() === "PUT") {
        const input = request.postDataJSON() as {
          narrationVersionId: string;
          beats: Array<{
            startMs: number;
            endMs: number;
            title: string;
            summary?: string;
          }>;
        };
        beats = input.beats.map((beat, order) => ({
          _id: `beat-${order + 1}`,
          narrationVersionId: input.narrationVersionId,
          order,
          ...beat,
        }));
        await route.fulfill({
          status: 200,
          json: { beatIds: beats.map((beat) => beat._id) },
        });
        return;
      }
    }
    if (
      url.pathname === "/api/projects/project-election-night/compositions" &&
      project
    ) {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          json: {
            current: composition
              ? {
                  _id: `composition-${compositionVersion}`,
                  version: compositionVersion,
                  provenance: "manual",
                  narrationVersionId: composition.narrationVersionId,
                  composition,
                  createdAt: 500 + compositionVersion,
                }
              : null,
            versions: Array.from(
              { length: compositionVersion },
              (_, index) => ({
                _id: `composition-${compositionVersion - index}`,
                version: compositionVersion - index,
                provenance: "manual",
                narrationVersionId:
                  composition?.narrationVersionId ?? "narration-version-1",
                segmentCount: composition?.segments.length ?? 0,
                createdAt: 500 + compositionVersion - index,
              }),
            ),
          },
        });
        return;
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON() as {
          composition: typeof composition;
        };
        composition = input.composition;
        compositionVersion += 1;
        await route.fulfill({
          status: 201,
          json: {
            compositionVersionId: `composition-${compositionVersion}`,
            version: compositionVersion,
          },
        });
        return;
      }
    }
    if (
      url.pathname ===
        "/api/projects/project-election-night/composition-proposals" &&
      project
    ) {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          json: proposals.map((proposal) => {
            const publicProposal = { ...proposal };
            delete publicProposal.proposedComposition;
            return publicProposal;
          }),
        });
        return;
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON() as {
          action: "propose" | "accept" | "reject";
          request?: string;
          proposalId?: string;
        };
        if (input.action === "propose") {
          const secondBeat = beats[1]!;
          const proposedComposition = {
            ...composition!,
            segments: [
              ...composition!.segments.filter(
                (segment) => segment.anchor.beatId !== secondBeat._id,
              ),
              {
                id: "agent-animated-line-chart-beat-2",
                kind: "component" as const,
                componentVersionId: "approved-line-chart-v1",
                input: {
                  title: "Regional result",
                  points: [42, 55, 73],
                },
                anchor: {
                  kind: "beat" as const,
                  beatId: secondBeat._id,
                  startMs: secondBeat.startMs,
                  endMs: secondBeat.endMs,
                },
              },
            ],
          };
          proposals = [
            {
              _id: "proposal-1",
              request: String(input.request),
              state: "reviewable",
              rationale:
                "Place approved animated-line-chart@1.0.0 on beat 2 (Regional explanation).",
              patchJson: JSON.stringify({
                operation: "insert",
                component: "animated-line-chart@1.0.0",
              }),
              validationEvidenceJson: JSON.stringify([
                {
                  attempt: 1,
                  valid: true,
                  message: "Proposal passed independent validation.",
                },
              ]),
              toolActivityJson: JSON.stringify([
                "read_current_composition",
                "read_narration_beats",
                "read_approved_component_library",
              ]),
              provider: "relay-fake-editor",
              model: "deterministic-composition-v1",
              attempt: 1,
              maxAttempts: 2,
              inputTokens: 9,
              outputTokens: 42,
              estimatedCostUsd: 0,
              createdAt: 600,
              proposedComposition,
            },
            ...proposals,
          ];
          await route.fulfill({
            status: 201,
            json: { proposalId: "proposal-1" },
          });
          return;
        }
        const proposal = proposals.find(
          (candidate) => candidate._id === input.proposalId,
        )!;
        if (input.action === "accept") {
          composition = proposal.proposedComposition;
          compositionVersion += 1;
          proposal.state = "accepted";
          proposal.acceptedCompositionVersionId = `composition-${compositionVersion}`;
          await route.fulfill({
            status: 200,
            json: {
              compositionVersionId: proposal.acceptedCompositionVersionId,
              version: compositionVersion,
            },
          });
          return;
        }
        proposal.state = "rejected";
        await route.fulfill({
          status: 200,
          json: { proposalId: proposal._id },
        });
        return;
      }
    }
    if (
      url.pathname === "/api/projects/project-election-night/draft-renders" &&
      project
    ) {
      if (request.method() === "GET") {
        const active = projectRenders.find((job) =>
          ["queued", "running"].includes(job.state),
        );
        if (active) {
          projectRenderPolls += 1;
          if (projectRenderPolls >= 2) {
            active.state = "running";
            active.progress = 0.48;
            active.attempt = 1;
          }
          if (projectRenderPolls >= 3) {
            active.state = "succeeded";
            active.progress = 1;
            active.outputUrl = "https://download.test/project-draft.mp4";
            active.outputSizeBytes = 16;
            active.wallTimeMs = 320;
            active.terminalMessage =
              "Draft MP4 rendered with pinned narration.";
          }
        }
        await route.fulfill({ status: 200, json: projectRenders });
        return;
      }
      const input = request.postDataJSON() as {
        action: "render" | "cancel";
        range?: { startMs: number; endMs: number };
        jobId?: string;
      };
      if (input.action === "render") {
        const latestNarration = narrationVersions[0]!;
        const job: MockProjectRender = {
          _id: `project-render-${projectRenders.length + 1}`,
          rangeKind: input.range ? "selection" : "full",
          rangeStartMs: input.range?.startMs ?? 0,
          rangeEndMs: input.range?.endMs ?? latestNarration.durationMs,
          width: 640,
          height: 360,
          fps: 30,
          state: "queued",
          progress: 0,
          attempt: 0,
          maxAttempts: 2,
          cancelRequested: false,
          createdAt: 700 + projectRenders.length,
          updatedAt: 700 + projectRenders.length,
        };
        projectRenders = [job, ...projectRenders];
        projectRenderPolls = 0;
        await route.fulfill({
          status: 202,
          json: { jobId: job._id },
        });
        return;
      }
      const job = projectRenders.find(
        (candidate) => candidate._id === input.jobId,
      )!;
      job.state = "canceled";
      job.cancelRequested = true;
      await route.fulfill({ status: 200, json: { jobId: job._id } });
      return;
    }
    if (url.pathname === "/api/projects/project-election-night" && project) {
      if (request.method() === "GET") {
        await route.fulfill({ status: 200, json: { channel, project } });
        return;
      }
      if (request.method() === "PATCH") {
        const input = request.postDataJSON() as
          | { action: "update"; name: string; description?: string }
          | { action: "archive" };
        if (input.action === "update") {
          project = {
            ...project,
            name: input.name,
            description: input.description,
            updatedAt: 200,
          };
        } else {
          project = {
            ...project,
            status: "archived",
            archivedAt: 300,
            updatedAt: 300,
          };
        }
        await route.fulfill({ status: 200, json: { projectId: project._id } });
        return;
      }
    }
    await route.fulfill({ status: 404, json: { message: "Not found." } });
  });

  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "Every video starts with a project." }),
  ).toBeVisible();
  await expect(page.getByText("No active projects")).toBeVisible();

  await page.getByLabel("Project name").fill("Election night explained");
  await page
    .getByLabel("Production note optional")
    .fill("A source-led results video.");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/projects\/project-election-night$/);
  await expect(
    page.getByRole("heading", { name: "Election night explained" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Project name")).toHaveValue(
    "Election night explained",
  );

  const firstScript = "Opening line.\n\nThe first explanation.";
  await page.getByLabel("Script text").fill(firstScript);
  await page.getByLabel("Script provenance").selectOption("import");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Current · v1")).toBeVisible();

  await page
    .getByLabel("Script text")
    .fill("Revised opening.\n\nThe first explanation.");
  await page.getByLabel("Script provenance").selectOption("manual");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Current · v2")).toBeVisible();
  await page.getByRole("link", { name: /Version 1/ }).click();
  await expect(page).toHaveURL(
    /\/projects\/project-election-night\/scripts\/1$/,
  );
  await expect(page.getByText(firstScript, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(firstScript, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to project" }).click();
  await expect(page.getByLabel("Script text")).toHaveValue(
    "Revised opening.\n\nThe first explanation.",
  );

  await page.getByLabel("Script version").selectOption("script-1");
  await page.getByRole("button", { name: "Generate timed narration" }).click();
  await expect(
    page.getByText("Waiting for the narration worker"),
  ).toBeVisible();
  await expect(
    page.getByText("Narration generated with timing."),
  ).toBeVisible();
  await expect(
    page.getByText("2.0 seconds with 2 timing segments"),
  ).toBeVisible();
  await expect(page.locator("audio[controls]").first()).toHaveAttribute(
    "src",
    /^data:audio\/wav/,
  );
  await expect(page.getByText("0:00.0–0:00.8")).toBeVisible();
  await expect(page.getByText("Opening line.", { exact: true })).toBeVisible();

  await page.getByLabel("Narration audio file").setInputFiles({
    name: "voiceover.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF uploaded narration"),
  });
  await page
    .getByRole("button", { name: "Upload and probe narration" })
    .click();
  await expect(
    page.getByText("Uploaded narration probed and ready."),
  ).toBeVisible();
  await expect(page.getByText(/voiceover\.wav · pcm_s16le/)).toBeVisible();
  await expect(page.getByText("Superseded")).toBeVisible();

  await page.getByLabel("Narration audio file").setInputFiles({
    name: "voiceover-final.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF replacement narration"),
  });
  await page
    .getByRole("button", { name: "Upload and probe narration" })
    .click();
  await expect(
    page.getByText("voiceover-final.wav", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Version 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Superseded")).toHaveCount(2);
  await expect(page.locator("audio[controls]").first()).toHaveAttribute(
    "src",
    /^data:audio\/wav/,
  );

  await expect(
    page.getByRole("heading", { name: "Shape narration into timed beats" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add beat" }).click();
  await page.getByLabel("Beat 1 title").fill("Opening hook");
  await page.getByLabel("Beat 1 summary").fill("Name the surprising result.");
  await page.getByRole("button", { name: "Split" }).click();
  await page.getByLabel("Beat 2 title").fill("Regional explanation");
  await page.getByLabel("Beat 1 end seconds").fill("1.1");
  await page.getByLabel("Beat 2 start seconds").fill("1.1");
  await page.getByRole("button", { name: "Save beat timeline" }).click();
  await expect(page.getByText("Beat timeline saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Beat 1 title")).toHaveValue("Opening hook");
  await expect(page.getByLabel("Beat 1 end seconds")).toHaveValue("1.1");
  await expect(page.getByLabel("Beat 2 title")).toHaveValue(
    "Regional explanation",
  );

  await expect(
    page.getByRole("heading", {
      name: "Place approved visuals on the story",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Approved component")).toHaveValue(
    "result-card",
  );
  await expect(page.getByLabel("Exact approved version")).toHaveValue(
    "approved-result-card-v1",
  );
  await page.getByLabel("Component input title").fill("Regional result");
  await page.getByLabel("Component input score").fill("72");
  await page.getByRole("button", { name: "Insert at beat" }).click();
  await expect(page.getByText("Composition version 1 saved.")).toBeVisible();
  await expect(page.getByText("result-card@1.0.0")).toBeVisible();
  await page
    .getByLabel("Segment 1 inputs")
    .fill('{"title":"Verified regional result","score":73}');
  await page.getByRole("button", { name: "Save inputs" }).click();
  await expect(page.getByText("Composition version 2 saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Segment 1 inputs")).toContainText(
    "Verified regional result",
  );
  const compositionSection = page
    .locator("section")
    .filter({ hasText: "Project composition" });
  await expect(compositionSection.getByText("Current · v2")).toBeVisible();

  await expect(
    page.getByRole("heading", {
      name: "Watch the composition on narration time",
    }),
  ).toBeVisible();
  const renderFrame = page.getByTestId("composition-render-frame");
  await expect(renderFrame.getByTestId("preview-editing-overlays")).toHaveCount(
    0,
  );
  await page.getByLabel("Composition timeline").fill("450");
  await expect(page.getByTestId("composition-frame-output")).toContainText(
    "frame 13",
  );
  const componentFrame = page.getByTitle("Composition rendered frame");
  await expect
    .poll(async () =>
      componentFrame.contentFrame().locator("body").getAttribute("data-frame"),
    )
    .toBe("13");
  await page
    .getByRole("button", { name: /Regional explanation · frame/ })
    .click();
  await expect(page.getByTestId("composition-frame-output")).toContainText(
    "frame 33",
  );
  await page.getByRole("button", { name: /Opening hook · frame 0/ }).click();
  await page.getByRole("button", { name: "Play composition" }).click();
  await expect
    .poll(async () => page.getByLabel("Composition timeline").inputValue())
    .not.toBe("0");
  await page.getByRole("button", { name: "Pause composition" }).click();

  await page.getByLabel("Editing request").fill("put the line chart on beat 2");
  await page.getByRole("button", { name: "Ask Relay for proposal" }).click();
  await expect(page.getByText("reviewable", { exact: true })).toBeVisible();
  await expect(
    page.getByText("animated-line-chart@1.0.0", { exact: true }),
  ).toBeVisible();
  await expect(compositionSection.getByText("Current · v2")).toBeVisible();
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(page.getByText("accepted", { exact: true })).toBeVisible();
  await expect(compositionSection.getByText("Current · v3")).toBeVisible();
  await page
    .getByRole("button", { name: /Regional explanation · frame/ })
    .click();
  await expect(page.getByTitle("Composition rendered frame")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Render a review MP4" }),
  ).toBeVisible();
  await expect(page.getByLabel("Draft range")).toHaveValue("full");
  await page.getByRole("button", { name: "Render draft MP4" }).click();
  await expect(
    page.getByRole("progressbar", { name: "Draft render progress" }),
  ).toBeVisible();
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download draft MP4" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "relay-project-draft.mp4",
  );

  await expect(page.getByText("No sources added yet")).toBeVisible();
  await page.getByLabel("Source title").fill("National results");
  await page.getByLabel("URL").fill("https://example.com/results");
  await page.getByRole("button", { name: "Add web source" }).click();
  await expect(page.getByText("National results")).toBeVisible();

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByLabel("Choose a source file").setInputFiles({
    name: "briefing.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Source briefing."),
  });
  await page.getByRole("button", { name: "Upload source" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The source could not be saved" }),
  ).toContainText("Storage is unavailable. Try again.");
  await expect(
    page.getByRole("button", { name: "Upload source" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Upload source" }).click();
  await expect(page.getByText("briefing.txt").first()).toBeVisible();
  await expect(page.getByText("2 sources")).toBeVisible();

  const resultsSource = page
    .locator("article")
    .filter({ hasText: "National results" });
  await resultsSource.getByRole("button", { name: "Remove source" }).click();
  await resultsSource.getByRole("button", { name: "Confirm remove" }).click();
  await expect(page.getByText("National results")).toHaveCount(0);
  await expect(page.getByText("briefing.txt").first()).toBeVisible();

  await page.getByLabel("Project name").fill("Election results explained");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Election results explained" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByText("This project is read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );

  await page.getByRole("link", { name: "All projects" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await expect(page.getByText("Election results explained")).toBeVisible();
});

function silentWavDataUrl(durationMs: number): string {
  const sampleRate = 8_000;
  const sampleCount = Math.ceil((durationMs / 1_000) * sampleRate);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}
