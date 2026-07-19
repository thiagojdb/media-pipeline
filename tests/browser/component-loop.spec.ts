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
    if (path.endsWith("/revisions")) {
      candidates.push(candidate("candidate-1.1.0", "1.1.0"));
      await route.fulfill({ status: 202, json: { turnId: "turn-1.1.0" } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: status(candidates, versions),
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
) {
  return {
    authoringMode: "real",
    model: "openai-codex/gpt-5.4-mini",
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
