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
  const scriptRevisionProposals: Array<{
    _id: string;
    baseScriptVersionId: string;
    baseScriptVersionNumber: number;
    baseDraftHash: string;
    scope: "selection" | "document";
    selectionFrom: number;
    selectionTo: number;
    selectedText: string;
    instruction: string;
    replacementMarkdown: string;
    rationale: string;
    state: "reviewable" | "applied" | "rejected";
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    wallTimeMs: number;
    createdAt: number;
    updatedAt: number;
  }> = [];
  type MockNarrationVersion = {
    _id: string;
    projectId: string;
    scriptVersionId?: string;
    planVersionId: string;
    version: number;
    provenance: "upload";
    alignmentState: "reviewable" | "approved";
    mediaType: string;
    audioUrl: string;
    durationMs: number;
    transcript: string;
    wordTimings: Array<{
      index: number;
      word: string;
      startMs: number;
      endMs: number;
      cueIndex?: number;
      planWordIndex?: number;
      match: "exact" | "substitution" | "insertion";
    }>;
    omittedWordCount: number;
    insertedWordCount: number;
    substitutedWordCount: number;
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
  type MockNarrationPlan = {
    _id: string;
    scriptVersionId: string;
    version: number;
    state: "reviewable" | "approved";
    cues: Array<{
      index: number;
      sourceStart: number;
      sourceEnd: number;
      text: string;
    }>;
    wordCount: number;
    estimatedDurationMs: number;
    createdAt: number;
    updatedAt: number;
  };
  const narrationPlans: MockNarrationPlan[] = [];
  let currentNarrationPlanVersionId: string | null = null;
  let currentNarrationVersionId: string | null = null;
  const narrationVersions: MockNarrationVersion[] = [];
  let narrationJob:
    | {
        _id: string;
        kind: "upload";
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
  let editCompositionReads = 0;
  let editBeatReads = 0;
  let editLibraryReads = 0;

  await page
    .context()
    .route("**/api/component-loop/library**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      editLibraryReads += 1;
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
      url.pathname ===
        "/api/projects/project-election-night/script-revisions" &&
      project
    ) {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          json:
            url.searchParams.get("models") === "1"
              ? [
                  {
                    provider: "relay-fake-script-editor",
                    model: "deterministic-revision-v1",
                    label: "Relay test editor",
                    default: true,
                  },
                ]
              : scriptRevisionProposals.toReversed(),
        });
        return;
      }
      const input = request.postDataJSON() as
        | {
            action: "propose";
            baseScriptVersionId: string;
            baseDraft: string;
            instruction: string;
            scope: "selection" | "document";
            selectionFrom: number;
            selectionTo: number;
            selectedText: string;
          }
        | {
            action: "apply" | "reject";
            proposalId: string;
          };
      if (input.action === "propose") {
        const base = scriptVersions.at(-1)!;
        const proposal = {
          _id: `script-proposal-${scriptRevisionProposals.length + 1}`,
          baseScriptVersionId: input.baseScriptVersionId,
          baseScriptVersionNumber: base.version,
          baseDraftHash: "draft-hash",
          scope: input.scope,
          selectionFrom: input.selectionFrom,
          selectionTo: input.selectionTo,
          selectedText: input.selectedText,
          instruction: input.instruction,
          replacementMarkdown: input.selectedText.toUpperCase(),
          rationale: "Make the selected passage more direct.",
          state: "reviewable" as const,
          provider: "relay-fake-script-editor",
          model: "deterministic-revision-v1",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          wallTimeMs: 0,
          createdAt: 250,
          updatedAt: 250,
        };
        scriptRevisionProposals.push(proposal);
        await route.fulfill({
          status: 201,
          json: { proposalId: proposal._id },
        });
        return;
      }
      const proposal = scriptRevisionProposals.find(
        (candidate) => candidate._id === input.proposalId,
      )!;
      proposal.state = input.action === "apply" ? "applied" : "rejected";
      await route.fulfill({
        status: 200,
        json: { proposalId: proposal._id },
      });
      return;
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
      url.pathname === "/api/projects/project-election-night/narration-plans" &&
      project
    ) {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          json: {
            currentPlanVersionId: currentNarrationPlanVersionId,
            versions: narrationPlans,
          },
        });
        return;
      }
      const input = request.postDataJSON() as {
        action: "create" | "update" | "approve";
        scriptVersionId?: string;
        planVersionId?: string;
        cues?: MockNarrationPlan["cues"];
      };
      if (input.action === "create") {
        const plan: MockNarrationPlan = {
          _id: `narration-plan-${narrationPlans.length + 1}`,
          scriptVersionId: String(input.scriptVersionId),
          version: narrationPlans.length + 1,
          state: "reviewable",
          cues: [
            {
              index: 0,
              sourceStart: 0,
              sourceEnd: 13,
              text: "Opening line.",
            },
            {
              index: 1,
              sourceStart: 15,
              sourceEnd: 37,
              text: "The first explanation.",
            },
          ],
          wordCount: 5,
          estimatedDurationMs: 2_000,
          createdAt: 290,
          updatedAt: 290,
        };
        narrationPlans.unshift(plan);
        await route.fulfill({ status: 201, json: plan });
        return;
      }
      const plan = narrationPlans.find(
        (candidate) => candidate._id === input.planVersionId,
      )!;
      if (input.action === "update") {
        plan.cues = input.cues ?? plan.cues;
        plan.updatedAt += 1;
      } else {
        plan.state = "approved";
        currentNarrationPlanVersionId = plan._id;
      }
      await route.fulfill({ status: 200, json: plan });
      return;
    }
    if (
      url.pathname === "/api/projects/project-election-night/narrations" &&
      project
    ) {
      if (request.method() === "POST") {
        const input = request.postDataJSON() as {
          action:
            | "cancel"
            | "prepare_upload"
            | "finalize_upload"
            | "approve_alignment";
          narrationVersionId?: string;
          fileName?: string;
        };
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
            provider: "pending-alignment",
            model: "pending-alignment",
            createdAt: 400 + narrationUploadCount,
          };
          narrationPolls = 0;
          await route.fulfill({
            status: 202,
            json: { jobId: narrationJob._id },
          });
          return;
        }
        if (input.action === "approve_alignment") {
          const version = narrationVersions.find(
            (candidate) => candidate._id === input.narrationVersionId,
          )!;
          version.alignmentState = "approved";
          currentNarrationVersionId = version._id;
          await route.fulfill({
            status: 200,
            json: {
              narrationVersionId: version._id,
              version: version.version,
            },
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
              terminalMessage: "Narration take aligned with word timing.",
            };
            if (
              !narrationVersions.some(
                (version) => version.fileName === pendingNarrationFileName,
              )
            ) {
              narrationVersions.unshift({
                _id: `narration-version-${narrationVersions.length + 1}`,
                projectId: project._id,
                scriptVersionId: narrationPlans[0]?.scriptVersionId,
                planVersionId: currentNarrationPlanVersionId!,
                version: narrationVersions.length + 1,
                provenance: "upload",
                alignmentState: "reviewable",
                mediaType: "audio/wav",
                audioUrl: silentWavDataUrl(3_000),
                durationMs: 2_500 + narrationUploadCount * 100,
                transcript: "Opening line. The first explanation.",
                wordTimings: [
                  {
                    index: 0,
                    word: "Opening",
                    startMs: 0,
                    endMs: 350,
                    cueIndex: 0,
                    planWordIndex: 0,
                    match: "exact",
                  },
                  {
                    index: 1,
                    word: "line",
                    startMs: 350,
                    endMs: 700,
                    cueIndex: 0,
                    planWordIndex: 1,
                    match: "exact",
                  },
                  {
                    index: 2,
                    word: "The",
                    startMs: 900,
                    endMs: 1_100,
                    cueIndex: 1,
                    planWordIndex: 2,
                    match: "exact",
                  },
                  {
                    index: 3,
                    word: "first",
                    startMs: 1_100,
                    endMs: 1_450,
                    cueIndex: 1,
                    planWordIndex: 3,
                    match: "exact",
                  },
                  {
                    index: 4,
                    word: "explanation",
                    startMs: 1_450,
                    endMs: 2_000,
                    cueIndex: 1,
                    planWordIndex: 4,
                    match: "exact",
                  },
                ],
                omittedWordCount: 0,
                insertedWordCount: 0,
                substitutedWordCount: 0,
                timingSegments: [
                  {
                    index: 0,
                    startMs: 0,
                    endMs: 700,
                    text: "Opening line.",
                  },
                  {
                    index: 1,
                    startMs: 900,
                    endMs: 2_000,
                    text: "The first explanation.",
                  },
                ],
                provider: "test-transcriber",
                model: "word-timing-v1",
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
            currentNarrationVersionId,
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
        editBeatReads += 1;
        await route.fulfill({
          status: 200,
          json: {
            currentNarrationVersionId,
            narrationVersions: narrationVersions
              .filter((version) => version.alignmentState === "approved")
              .map(({ _id, version, durationMs }) => ({
                _id,
                version,
                durationMs,
              })),
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
        editCompositionReads += 1;
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
          const proposalId = `proposal-${proposals.length + 1}`;
          const requestText = String(input.request);
          const invalid = /\bbeat 9\b/i.test(requestText);
          const slow = /\bslow\b.*\bchart\b/i.test(requestText);
          const secondBeat = beats[1]!;
          const proposedComposition = invalid
            ? undefined
            : slow
              ? {
                  ...composition!,
                  segments: composition!.segments.map((segment, index) =>
                    index === 0
                      ? {
                          ...segment,
                          input: {
                            ...(segment.input as Record<string, unknown>),
                            durationPerBar: 36,
                          },
                        }
                      : segment,
                  ),
                }
              : {
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
              _id: proposalId,
              request: requestText,
              state: invalid ? "invalid" : "reviewable",
              rationale: invalid
                ? "I could not find beat 9 on the pinned narration version."
                : slow
                  ? "Slow approved result-card@1.0.0 on beat 1 by increasing its animation duration input."
                  : "Place approved animated-line-chart@1.0.0 on beat 2 (Regional explanation).",
              patchJson: invalid
                ? undefined
                : JSON.stringify({
                    operation: slow ? "set_inputs" : "insert",
                    component: slow
                      ? "result-card@1.0.0"
                      : "animated-line-chart@1.0.0",
                  }),
              validationEvidenceJson: JSON.stringify([
                {
                  attempt: 1,
                  valid: !invalid,
                  message: invalid
                    ? "Beat 9 is unavailable."
                    : "Proposal passed independent validation.",
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
              ...(proposedComposition ? { proposedComposition } : {}),
            },
            ...proposals,
          ];
          await route.fulfill({
            status: 201,
            json: { proposalId },
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

  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
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
  await page.getByRole("button", { name: /Project settings/ }).click();
  await expect(page.getByLabel("Project name")).toHaveValue(
    "Election night explained",
  );
  await page
    .getByRole("dialog", { name: "Project details" })
    .getByRole("button", { name: "Close project settings" })
    .click();

  const scriptEditor = page.getByRole("textbox", { name: "Script text" });
  await scriptEditor.fill("Opening line\n\nThe first explanation.");
  await scriptEditor.press("Control+a");
  await page.getByRole("button", { name: "Heading 1" }).click();
  const firstScriptRefresh = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "GET" &&
      new URL(response.url()).pathname.endsWith(
        "/project-election-night/scripts",
      )
    );
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await firstScriptRefresh;
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await scriptEditor.fill("Revised opening\n\nThe first explanation.");
  await scriptEditor.press("Control+a");
  await page.getByRole("button", { name: "Heading 2" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await scriptEditor.selectText();
  await page
    .getByRole("button", { name: "Ask for changes to selection" })
    .click();
  await page.getByLabel("Describe changes").fill("Make this uppercase");
  await page.getByLabel("Describe changes").press("Enter");
  await expect(page.getByText(/REVISED OPENING/).first()).toBeVisible();
  const originalDiffLine = page.locator(".revision-original-pending").first();
  const replacementDiffLine = page.locator(".revision-replacement").first();
  await expect(originalDiffLine).toBeVisible();
  await expect(replacementDiffLine).toBeVisible();
  await expect
    .poll(async () => {
      const originalBox = await originalDiffLine.boundingBox();
      const replacementBox = await replacementDiffLine.boundingBox();
      if (!originalBox || !replacementBox) return -1;
      return Math.round(
        replacementBox.y - (originalBox.y + originalBox.height),
      );
    })
    .toBeGreaterThanOrEqual(0);
  const rejectChanges = page.getByRole("button", {
    name: "Reject this change",
  });
  const changeCount = await rejectChanges.count();
  expect(changeCount).toBeGreaterThan(1);
  await rejectChanges.first().click();
  const remainingCount = changeCount - 1;
  await expect(
    page.getByText(
      `${remainingCount} ${remainingCount === 1 ? "change" : "changes"} left · 1 rejected`,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept remaining" }).click();
  await expect(scriptEditor).toContainText("Revised opening");
  await expect(scriptEditor).toContainText("THE FIRST EXPLANATION.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(scriptEditor).toContainText("Revised opening");
  await expect(scriptEditor).toContainText("THE FIRST EXPLANATION.");

  await page.getByRole("button", { name: "Narration", exact: true }).click();
  await page.getByLabel("Script version").selectOption("script-1");
  await page.getByRole("button", { name: "Propose narration plan" }).click();
  await expect(page.getByText("Plan version 1")).toBeVisible();
  await expect(page.getByLabel("Narration cue 1")).toHaveValue("Opening line.");
  await page.getByRole("button", { name: "Approve spoken text" }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(page.getByText("Opening line.", { exact: true })).toBeVisible();

  await page.getByLabel("Narration audio file").setInputFiles({
    name: "voiceover.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF uploaded narration"),
  });
  await page.getByRole("button", { name: "Upload and align words" }).click();
  await expect(
    page.getByText("Narration take aligned with word timing."),
  ).toBeVisible();
  await expect(page.getByText("Track candidate v1")).toBeVisible();
  await expect(page.getByText("5 timed words")).toBeVisible();
  await expect(page.locator("audio[controls]").first()).toHaveAttribute(
    "src",
    /^data:audio\/wav/,
  );
  await page.getByRole("button", { name: "Approve aligned track" }).click();
  await expect(page.getByText("approved", { exact: true })).toHaveCount(2);

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
  await page.getByRole("button", { name: "Narration", exact: true }).click();
  await expect(page.getByLabel("Beat 1 title")).toHaveValue("Opening hook");
  await expect(page.getByLabel("Beat 1 end seconds")).toHaveValue("1.1");
  await expect(page.getByLabel("Beat 2 title")).toHaveValue(
    "Regional explanation",
  );

  editCompositionReads = 0;
  editBeatReads = 0;
  editLibraryReads = 0;
  await page
    .getByRole("navigation", { name: "Production stages" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
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
  await page.waitForTimeout(250);
  expect(editCompositionReads).toBe(2);
  expect(editBeatReads).toBe(2);
  expect(editLibraryReads).toBe(2);
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
  await page
    .getByRole("navigation", { name: "Production stages" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
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

  await page.getByRole("button", { name: "Review", exact: true }).click();
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

  await page
    .getByRole("navigation", { name: "Production stages" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Editing request").fill("put the chart on beat 9");
  await page.getByRole("button", { name: "Ask Relay for proposal" }).click();
  await expect(page.getByText("invalid", { exact: true })).toBeVisible();
  await expect(compositionSection.getByText("Current · v3")).toBeVisible();

  await page.getByLabel("Editing request").fill("slow this chart down");
  await page.getByRole("button", { name: "Ask Relay for proposal" }).click();
  await expect(
    page.getByText("result-card@1.0.0", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(compositionSection.getByText("Current · v4")).toBeVisible();
  await expect(
    page.getByText("4 immutable composition versions"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Render draft MP4" }).click();
  await expect(page.getByText("succeeded", { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "Download draft MP4" }),
  ).toHaveCount(2);

  await page.getByRole("button", { name: "Sources", exact: true }).click();
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

  await page.getByRole("button", { name: /Project settings/ }).click();
  await page.getByLabel("Project name").fill("Election results explained");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Election results explained" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );

  await page.getByRole("link", { name: "All projects" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await expect(page.getByText("Election results explained")).toBeVisible();
});

test("keeps a long-form script navigable at desktop and narrow widths", async ({
  page,
}) => {
  const headings = [
    "COLD OPEN",
    "PART ONE: WHAT VICTORY MEANS",
    "PART TWO: THE MAP",
    "PART THREE: THE CHOKEPOINT",
    "PART FOUR: THE ALLIANCES",
    "PART FIVE: THE COST",
    "PART SIX: THE EXCHANGE",
    "PART SEVEN: THE FINANCIAL CLOCK",
    "PART EIGHT: THE SECURITY DILEMMA",
    "PART NINE: THE COUNTERARGUMENT",
    "PART TEN: THE REGIME",
    "PART ELEVEN: THE NUCLEAR PROBLEM",
    "PART TWELVE: THREE ENDINGS",
    "CONCLUSION: WHAT CANNOT BE WON",
  ];
  const paragraph =
    "Narration follows the evidence, explains the consequence, and keeps the visual direction connected to the argument. ";
  const script = headings
    .map(
      (heading, index) =>
        `${heading}\n\n[VISUAL: Production direction ${index + 1}.]\n\n${paragraph.repeat(22)}`,
    )
    .join("\n\n");

  expect(script.length).toBeGreaterThan(30_000);

  await page
    .context()
    .route("**/api/projects/project-long-script**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/script-revisions")) {
        await route.fulfill({
          status: 200,
          json:
            url.searchParams.get("models") === "1"
              ? [
                  {
                    provider: "kimi-code",
                    model: "k3-256k",
                    label: "Kimi K3 256K",
                    default: true,
                  },
                  {
                    provider: "kimi-code",
                    model: "kimi-for-coding",
                    label: "Kimi K2.7 Code",
                    default: false,
                  },
                ]
              : [],
        });
        return;
      }
      if (url.pathname.endsWith("/scripts")) {
        await route.fulfill({
          status: 200,
          json: {
            current: {
              _id: "script-long-v1",
              version: 1,
              content: script,
              provenance: "manual",
              createdAt: 100,
            },
            versions: [
              {
                _id: "script-long-v1",
                version: 1,
                provenance: "manual",
                createdAt: 100,
                characterCount: script.length,
                excerpt: script.slice(0, 140),
              },
            ],
            maximumCharacters: 100_000,
          },
        });
        return;
      }

      await route.fulfill({
        status: 200,
        json: {
          channel: {
            id: "channel-relay",
            slug: "relay-studio",
            name: "Relay Studio",
          },
          project: {
            _id: "project-long-script",
            name: "A long-form production",
            description: "A narration-led documentary.",
            status: "active",
            createdAt: 100,
            updatedAt: 100,
          },
        },
      });
    });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/project-long-script");
  await expect(
    page.getByRole("textbox", { name: "Script text" }),
  ).toContainText("CONCLUSION: WHAT CANNOT BE WON");
  const modelPicker = page.getByRole("combobox", { name: "Relay model" });
  await expect(modelPicker).toHaveValue("kimi-code/k3-256k");
  await modelPicker.selectOption("kimi-code/kimi-for-coding");
  await expect(modelPicker).toHaveValue("kimi-code/kimi-for-coding");
  await expect(
    page.getByText(`${script.length.toLocaleString()} / 100,000 chars`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight,
      ),
    )
    .toBeLessThanOrEqual(1);
  const markerRail = page.getByRole("navigation", {
    name: "Script sections",
  });
  const markerPositions = await markerRail
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().y),
    );
  expect(
    Math.max(...markerPositions) - Math.min(...markerPositions),
  ).toBeLessThan(200);
  await expect
    .poll(
      async () =>
        (await page.getByRole("textbox", { name: "Script text" }).boundingBox())
          ?.y,
    )
    .toBeLessThan(200);
  const sectionMarker = page.getByRole("button", {
    name: "Jump to PART TWELVE: THREE ENDINGS",
  });
  await sectionMarker.hover();
  await expect(
    page.getByRole("tooltip", { name: "PART TWELVE: THREE ENDINGS" }),
  ).toBeVisible();
  await sectionMarker.click();
  await expect
    .poll(() =>
      page.locator(".script-editor").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(1_000);
  await expect
    .poll(async () => {
      const editorTop = await page
        .locator(".script-editor")
        .evaluate((element) => element.getBoundingClientRect().top);
      const headingTop = await page
        .getByRole("textbox", { name: "Script text" })
        .getByText("PART TWELVE: THREE ENDINGS", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top);
      return Math.round(headingTop - editorTop);
    })
    .toBeGreaterThanOrEqual(20);
  await expect
    .poll(async () => {
      const editorTop = await page
        .locator(".script-editor")
        .evaluate((element) => element.getBoundingClientRect().top);
      const headingTop = await page
        .getByRole("textbox", { name: "Script text" })
        .getByText("PART TWELVE: THREE ENDINGS", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top);
      return Math.round(headingTop - editorTop);
    })
    .toBeLessThanOrEqual(30);
  await expect(sectionMarker).toHaveAttribute("aria-current", "location");
  await expect(
    page.getByRole("button", {
      name: "Jump to PART ELEVEN: THE NUCLEAR PROBLEM",
    }),
  ).not.toHaveAttribute("aria-current", "location");

  await page.getByRole("textbox", { name: "Script text" }).press("Control+End");
  await page.getByRole("textbox", { name: "Script text" }).press("Enter");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(
    page.getByRole("button", { name: "Jump to COLD OPEN" }),
  ).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Script text" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Production stages" }),
  ).toBeVisible();
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
