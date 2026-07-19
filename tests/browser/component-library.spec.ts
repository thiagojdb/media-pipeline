import { expect, test } from "@playwright/test";

test("opens the approved channel library and starts a fresh exact-version revision chat", async ({
  page,
}) => {
  const versions = [
    version("version-1.1.0", "1.1.0", "thread-origin-latest", 200),
    version("version-1.0.0", "1.0.0", "thread-origin-v1", 100),
  ];
  let revisionStarts = 0;
  let chatted = false;

  await page.context().route("**/api/component-loop/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/library")) {
      await route.fulfill({
        status: 200,
        json: [
          {
            id: "component-animated-bar-graph",
            componentId: "animated-bar-graph",
            updatedAt: 200,
            versionCount: 2,
            latestVersion: versions[0],
          },
        ],
      });
      return;
    }
    if (path.endsWith("/library/animated-bar-graph")) {
      await route.fulfill({
        status: 200,
        json: {
          id: "component-animated-bar-graph",
          componentId: "animated-bar-graph",
          latestApprovedVersionId: "version-1.1.0",
          createdAt: 100,
          updatedAt: 200,
          versions,
        },
      });
      return;
    }
    if (path.endsWith("/revision-thread")) {
      revisionStarts += 1;
      expect(path).toContain("/versions/version-1.0.0/revision-thread");
      await route.fulfill({ status: 201, json: { threadId: "thread-fresh" } });
      return;
    }
    if (path.endsWith("/threads/thread-fresh/messages")) {
      chatted = true;
      await route.fulfill({ status: 202, json: { messageId: "reply" } });
      return;
    }
    if (path.includes("/versions/") && path.endsWith("/preview")) {
      const versionId = path.split("/").at(-2)!;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<div role="img" aria-label="Exact ${versionId}">${versionId}</div>`,
      });
      return;
    }
    if (path.endsWith("/threads/thread-fresh")) {
      await route.fulfill({ status: 200, json: revisionStatus(chatted) });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Not found." } });
  });

  await page.goto("/components");

  await expect(
    page.getByRole("heading", { name: "Reusable components" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Animated Bar Graph" }),
  ).toBeVisible();
  await expect(page.getByText("Latest v1.1.0")).toBeVisible();
  await expect(page.getByText("2 versions")).toBeVisible();
  await expect(
    page.getByTitle("Approved preview of animated-bar-graph 1.1.0"),
  ).toBeVisible();

  await page.getByRole("link", { name: /Open component/ }).click();
  await expect(page).toHaveURL(/\/components\/animated-bar-graph$/);
  await expect(
    page.getByRole("heading", { name: "Version history" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /v1.1.0/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: /v1.0.0/ }).click();
  await expect(page).toHaveURL(/\?version=version-1.0.0$/);
  await expect(
    page.getByTitle("Approved preview of animated-bar-graph 1.0.0"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open original conversation/ }),
  ).toHaveAttribute("href", "/component-loop?thread=thread-origin-v1");

  await page.getByRole("button", { name: /Start revision chat/ }).click();
  await expect(page).toHaveURL(/\/component-loop\?thread=thread-fresh$/);
  await expect(
    page.getByText("Fresh revision chat", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Based on exact approved/)).toContainText(
    "animated-bar-graph@1.0.0",
  );
  await expect(
    page.getByText(/keep this approved version untouched/),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("relay.component-loop.thread-id"),
      ),
    )
    .toBe("thread-fresh");
  expect(revisionStarts).toBe(1);

  await page
    .getByRole("textbox", { name: "Message Relay" })
    .fill("Make the bars purple and keep the staggered animation.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Make the bars purple and keep the staggered animation."),
  ).toBeVisible();
  await expect(
    page.getByText("I understand the revision request."),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByText("Fresh revision chat", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Based on exact approved/)).toContainText(
    "animated-bar-graph@1.0.0",
  );
  expect(revisionStarts).toBe(1);
});

function version(
  id: string,
  number: string,
  originThreadId: string,
  approvedAt: number,
) {
  return {
    id,
    version: number,
    approvedAt,
    sourceHash: number.replaceAll(".", "").padEnd(64, "a"),
    fixtureCount: 2,
    previewFixtureId: "growth",
    previewFrame: 89,
    originThreadId,
    fixtures: [
      { id: "growth", name: "Staggered growth bars" },
      { id: "dense", name: "Dense dataset" },
    ],
    dimensions: [{ width: 1920, height: 1080 }],
  };
}

function revisionStatus(chatted: boolean) {
  return {
    authoringMode: "real",
    model: "openai-codex/gpt-5.4-mini",
    phase: "dialogue",
    theme: {
      colors: { accent: "#ef4444", background: "#07111f" },
      fonts: { heading: "Arial, sans-serif" },
      spacing: {},
    },
    selectedBaseVersion: {
      id: "version-1.0.0",
      componentId: "animated-bar-graph",
      version: "1.0.0",
      sourceHash: "100".padEnd(64, "a"),
      originThreadId: "thread-origin-v1",
      approvedAt: 100,
    },
    messages: [
      {
        _id: "selected-base-intro",
        messageId: "selected-base-intro",
        role: "assistant",
        state: "complete",
        content:
          "I’m ready to help revise animated-bar-graph@1.0.0. Tell me what you want to change, and I’ll keep this approved version untouched while we work.",
        safeStatus:
          "Fresh revision conversation opened from an exact approved version.",
        createdAt: 1,
      },
      ...(chatted
        ? [
            {
              _id: "revision-request",
              messageId: "revision-request",
              role: "user",
              state: "complete",
              content: "Make the bars purple and keep the staggered animation.",
              createdAt: 2,
            },
            {
              _id: "revision-reply",
              messageId: "revision-reply",
              role: "assistant",
              state: "complete",
              content: "I understand the revision request.",
              createdAt: 3,
            },
          ]
        : []),
    ],
    turns: [],
    activities: [],
    builds: [],
    candidates: [],
    versions: [],
    context: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0,
      compactsAutomatically: true,
      compactionCount: 0,
    },
  };
}
