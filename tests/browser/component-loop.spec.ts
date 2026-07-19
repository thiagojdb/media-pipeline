import { expect, test } from "@playwright/test";

test("previews exact source, revises in chat, approves, and reopens the version", async ({
  page,
}) => {
  const candidates = [candidate("candidate-1.0.0", "1.0.0")];
  const versions: Array<{
    id: string;
    componentId: string;
    version: string;
    approvedAt: number;
  }> = [];
  const messages = conversationMessages(
    "Create an animated data card for a weekly audience metric.",
    "I have enough detail to begin. I’m starting implementation now.",
  );

  await page.context().route("**/api/component-loop/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/requests")) {
      await route.fulfill({
        status: 202,
        json: { channelId: "channel-test", threadId: "thread-test" },
      });
      return;
    }
    if (path.endsWith("/source")) {
      const id = path.split("/").at(-2)!;
      const item = candidates.find((value) => value.id === id)!;
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: `export default defineVideoComponent({ version: "${item.version}" });`,
      });
      return;
    }
    if (path.endsWith("/preview")) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<svg role="img" aria-label="Exact generated chart"><path stroke="#a855f7" /></svg>',
      });
      return;
    }
    if (path.endsWith("/approve")) {
      const id = path.split("/").at(-2)!;
      const item = candidates.find((value) => value.id === id)!;
      item.status = "approved";
      versions.push({
        id: `version-${item.version}`,
        componentId: item.componentId,
        version: item.version,
        approvedAt: Date.now(),
      });
      await route.fulfill({
        status: 200,
        json: { versionId: versions.at(-1)!.id },
      });
      return;
    }
    if (path.endsWith("/messages")) {
      messages.push(
        message(
          "user-revision",
          "user",
          "Make the primary line purple and keep the drawn-on animation.",
          20,
        ),
        message(
          "assistant-revision",
          "assistant",
          "I’ll preserve the working version and start that revision now.",
          21,
          {
            transitionBrief:
              "Make the primary line purple and keep the drawn-on animation.",
          },
        ),
      );
      candidates.push(candidate("candidate-1.1.0", "1.1.0"));
      await route.fulfill({ status: 202, json: { turnId: "turn-1.1.0" } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: status(candidates, versions, messages),
    });
  });

  await page.goto("/component-loop");
  await page
    .getByRole("textbox", { name: "Message Relay" })
    .fill("Create an animated data card for a weekly audience metric.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(
    page.getByTitle("Exact preview of generated-chart 1.0.0"),
  ).toBeVisible();
  await expect(page.getByLabel("Context window 82% available")).toContainText(
    "82% context free",
  );
  await expect(page.getByText("~$0.12")).toBeVisible();
  await page.getByRole("button", { name: /Inspect generated source/ }).click();
  await expect(page.getByText(/defineVideoComponent/)).toBeVisible();

  await page
    .getByRole("textbox", { name: "Message Relay" })
    .fill("Make the primary line purple and keep the drawn-on animation.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(
    page.getByTitle("Exact preview of generated-chart 1.1.0"),
  ).toBeVisible();
  await expect(page.getByText(/Preserved for comparison/)).toBeVisible();
  await page.getByRole("button", { name: "Approve version" }).click();
  await expect(page.getByText("Version approved and saved")).toBeVisible();

  const approved = page.getByRole("link", {
    name: "generated-chart@v1.1.0",
  });
  await expect(approved).toHaveAttribute(
    "href",
    "/api/component-loop/versions/version-1.1.0/preview",
  );
  const popupPromise = page.waitForEvent("popup");
  await approved.click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("img", { name: "Exact generated chart" }),
  ).toBeVisible();
});

test("restores a durable conversation after reload and starts a new chat safely", async ({
  page,
}) => {
  const candidates = [candidate("candidate-persisted", "1.0.0")];
  const messages = conversationMessages(
    "Build a conversation I can reopen.",
    "The durable candidate is ready for review.",
  );
  const persistedTheme = {
    colors: {
      accent: "#7c3aed",
      background: "#020617",
      foreground: "#f8fafc",
      muted: "#94a3b8",
      grid: "#1e293b",
    },
    fonts: { heading: "Inter, sans-serif", body: "Inter, sans-serif" },
    spacing: { outer: 72 },
  };
  let starts = 0;

  await page.context().route("**/api/component-loop/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/requests")) {
      starts += 1;
      await route.fulfill({
        status: 202,
        json: { channelId: "channel-test", threadId: "thread-persisted" },
      });
      return;
    }
    if (path.endsWith("/preview")) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<div role="img" aria-label="Persisted generated component">persisted preview</div>',
      });
      return;
    }
    if (path.endsWith("/threads/thread-missing")) {
      await route.fulfill({
        status: 404,
        json: {
          message:
            "This Relay conversation is unavailable. Start a new chat or open a valid conversation link.",
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: status(candidates, [], messages, persistedTheme),
    });
  });

  await page.goto("/component-loop");
  await page
    .getByRole("textbox", { name: "Message Relay" })
    .fill("Build a conversation I can reopen.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page).toHaveURL(/\?thread=thread-persisted$/);
  await expect(
    page.getByTitle("Exact preview of generated-chart 1.0.0"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("relay.component-loop.thread-id"),
      ),
    )
    .toBe("thread-persisted");

  await page.reload();

  await expect(
    page.getByText("Build a conversation I can reopen."),
  ).toBeVisible();
  await expect(
    page.getByText("The durable candidate is ready for review."),
  ).toBeVisible();
  await expect(
    page.getByTitle("Exact preview of generated-chart 1.0.0"),
  ).toBeVisible();
  await expect(page.getByLabel("Accent color")).toHaveValue("#7c3aed");
  await expect(page.getByLabel("Background color")).toHaveValue("#020617");
  await expect(page.getByLabel("Heading font")).toHaveValue(
    "Inter, sans-serif",
  );
  expect(starts).toBe(1);

  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page).toHaveURL(/\/component-loop$/);
  await expect(page.getByText("What should Relay build?")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("relay.component-loop.thread-id"),
      ),
    )
    .toBeNull();
  expect(starts).toBe(1);

  await page.goto("/component-loop?thread=thread-missing");
  await expect(
    page.getByRole("alert").filter({ hasText: "Relay needs your attention" }),
  ).toContainText("This Relay conversation is unavailable");
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("What should Relay build?")).toBeVisible();
});

test("keeps the inline preview mounted during playback and repeated seeks", async ({
  page,
}) => {
  const candidates = [candidate("candidate-playback", "1.0.0")];
  const messages = conversationMessages(
    "Build a playback test component.",
    "Implementation finished and validation passed.",
  );
  let previewRequests = 0;

  await page.context().route("**/api/component-loop/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/requests")) {
      await route.fulfill({
        status: 202,
        json: { channelId: "channel-test", threadId: "thread-playback" },
      });
      return;
    }
    if (path.endsWith("/preview")) {
      previewRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body style="margin:0;background:#07111f"><div id="rendered-frame" data-frame="0">frame 0</div><script>
          addEventListener("message", event => {
            if (event.source !== parent || event.data?.type !== "relay-preview-frame-v1") return;
            const rendered = document.getElementById("rendered-frame");
            rendered.dataset.frame = String(event.data.frame);
            rendered.textContent = "frame " + event.data.frame;
          });
        </script></body></html>`,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: status(candidates, [], messages),
    });
  });

  await page.goto("/component-loop");
  await page
    .getByRole("textbox", { name: "Message Relay" })
    .fill("Build a playback test component.");
  await page.getByRole("button", { name: "Send message" }).click();

  const iframe = page.getByTitle("Exact preview of generated-chart 1.0.0");
  const renderedFrame = iframe.contentFrame().locator("#rendered-frame");
  await expect(renderedFrame).toHaveAttribute("data-frame", "45");
  await iframe.evaluate((node) => {
    (
      window as typeof window & { relayPreviewNode?: Element }
    ).relayPreviewNode = node;
  });

  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(renderedFrame).not.toHaveAttribute("data-frame", "45");
  await page.getByRole("button", { name: "Pause preview" }).click();

  const slider = page.getByLabel("Preview frame");
  for (const frame of [20, 90, 130]) await slider.fill(String(frame));
  await expect(renderedFrame).toHaveAttribute("data-frame", "130");
  await expect(renderedFrame).toBeVisible();
  await expect(iframe).toBeVisible();
  expect(previewRequests).toBe(1);
  await expect(
    iframe.evaluate(
      (node) =>
        (window as typeof window & { relayPreviewNode?: Element })
          .relayPreviewNode === node,
    ),
  ).resolves.toBe(true);
});

test("streams lightweight dialogue without creating a component", async ({
  page,
}) => {
  let polls = 0;
  await page.context().route("**/api/component-loop/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/requests")) {
      await route.fulfill({ status: 202, json: { threadId: "dialogue-only" } });
      return;
    }
    polls += 1;
    const streaming = polls < 3;
    await route.fulfill({
      status: 200,
      json: {
        authoringMode: "real",
        model: "openai-codex/gpt-5.4-mini",
        phase: "dialogue",
        messages: [
          message("hello", "user", "Hi, who are you?", 1),
          message(
            "reply",
            "assistant",
            streaming
              ? "Hi — I’m Relay"
              : "Hi — I’m Relay, your component-building partner. We can talk before I build anything.",
            2,
            { state: streaming ? "streaming" : "complete" },
          ),
        ],
        turns: [],
        activities: [],
        builds: [],
        candidates: [],
        versions: [],
      },
    });
  });
  await page.goto("/component-loop");
  await page
    .getByRole("textbox", { name: "Message Relay" })
    .fill("Hi, who are you?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Hi — I’m Relay", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/talk before I build anything/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message Relay" }),
  ).toBeEnabled();
});

function candidate(id: string, version: string) {
  return {
    id,
    componentId: "generated-chart",
    version,
    status: "reviewable",
    sourceHash: version.replaceAll(".", "").padEnd(64, "a"),
    versionAlreadyApproved: false,
    fixtures: [
      {
        id: "growth",
        name: "Channel growth",
        checkpoints: [{ frame: 0 }, { frame: 119 }],
      },
    ],
    validationEvidence: {
      checks: [
        {
          code: "preview_runtime",
          status: "passed",
          message: "All fixture frames passed.",
        },
      ],
    },
  };
}

function status(
  candidates: ReturnType<typeof candidate>[],
  versions: Array<{ id: string; version: string; approvedAt: number }>,
  messages: ReturnType<typeof conversationMessages>,
  theme = {
    colors: {
      accent: "#ef4444",
      background: "#07111f",
      foreground: "#f4f7fb",
      muted: "#91a3ba",
      grid: "#24364d",
    },
    fonts: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
    spacing: { outer: 72 },
  },
) {
  return {
    authoringMode: "real",
    model: "openai-codex/gpt-5.4-mini",
    theme,
    phase: candidates.length ? "review" : "dialogue",
    messages,
    turns: candidates.map((item) => ({
      id: `turn-${item.version}`,
      turnId: `turn-${item.version}`,
      userRequest:
        item.version === "1.0.0"
          ? "Build a line chart."
          : "Make the primary line purple and keep the drawn-on animation.",
      state: "candidate_submitted",
      repairAttempt: 0,
      modelTurns: 1,
      toolCalls: 4,
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      wallTimeMs: 75,
      assistantText:
        "I implemented the requested component and handed it to validation.",
      createdAt: item.version === "1.0.0" ? 10 : 30,
    })),
    activities: [],
    builds: candidates.map((item) => ({
      turnId: `turn-${item.version}`,
      state: "succeeded",
      candidateId: item.id,
    })),
    candidates,
    versions,
    context: {
      usedTokens: 50_000,
      maxTokens: 272_000,
      usedPercentage: (50_000 / 272_000) * 100,
      totalInputTokens: 61_000,
      totalOutputTokens: 8_000,
      totalCacheReadTokens: 42_000,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0.12,
      compactsAutomatically: true,
      compactionCount: 1,
    },
  };
}

function conversationMessages(user: string, assistant: string) {
  return [
    message("user-initial", "user", user, 1),
    message("assistant-initial", "assistant", assistant, 2, {
      transitionBrief: user,
    }),
  ];
}

function message(
  id: string,
  role: "user" | "assistant",
  content: string,
  createdAt: number,
  options: { state?: "streaming" | "complete"; transitionBrief?: string } = {},
) {
  return {
    _id: id,
    messageId: id,
    role,
    state: options.state ?? "complete",
    content,
    safeStatus:
      options.state === "streaming"
        ? "Thinking through your request…"
        : "Response complete.",
    transitionBrief: options.transitionBrief,
    inputTokens: 8,
    outputTokens: 12,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.001,
    createdAt,
  };
}
