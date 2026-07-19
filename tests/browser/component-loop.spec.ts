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
) {
  return {
    authoringMode: "real",
    model: "openai-codex/gpt-5.4-mini",
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
