import { expect, test } from "@playwright/test";

test("runs the deterministic creator review and revision workflow", async ({
  page,
}) => {
  let candidateVersion = "1.0.0";
  let candidateStatus = "reviewable";
  const versions: Array<{ id: string; version: string; approvedAt: number }> =
    [];

  await page.route("**/api/component-loop/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/requests")) {
      await route.fulfill({
        status: 202,
        json: { channelId: "channel-test", threadId: "thread-test" },
      });
      return;
    }
    if (path.endsWith("/approve")) {
      candidateStatus = "approved";
      versions.push({
        id: `version-${candidateVersion}`,
        version: candidateVersion,
        approvedAt: Date.now(),
      });
      await route.fulfill({
        status: 200,
        json: { versionId: versions.at(-1)!.id },
      });
      return;
    }
    if (path.endsWith("/revisions")) {
      candidateVersion = "1.1.0";
      candidateStatus = "reviewable";
      await route.fulfill({ status: 202, json: { turnId: "revision-test" } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        turns: [
          {
            id: "turn-test",
            state: "candidate_submitted",
            repairAttempt: 0,
            attempt: 1,
            modelTurns: 1,
            toolCalls: 4,
            inputTokens: 20,
            outputTokens: 10,
            wallTimeMs: 75,
          },
        ],
        candidates: [
          {
            id: `candidate-${candidateVersion}`,
            version: candidateVersion,
            status: candidateStatus,
            validationEvidence: {
              checks: [
                {
                  code: "preview_runtime",
                  status: "passed",
                  message: "All fixture frames passed.",
                },
              ],
            },
          },
        ],
        versions,
      },
    });
  });

  await page.goto("/component-loop");
  await page.getByRole("button", { name: "Build line chart" }).click();
  await expect(page.getByText("All fixture frames passed.")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(
    page.getByText("animated-line-chart@1.0.0").last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start revision" }).click();
  await expect(
    page.getByText("animated-line-chart@1.1.0").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(
    page.getByRole("link", { name: "Preview & render" }),
  ).toHaveCount(2);
});
