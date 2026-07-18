import { expect, test, type Page } from "@playwright/test";

const previewPath = "/components/animated-line-chart/versions/1.0.0/preview";

async function openPreview(page: Page) {
  await page.goto(previewPath);
  await expect(page.getByTestId("component-identity")).toHaveText(
    "animated-line-chart@1.0.0",
  );
}

test("rejects unknown ids and wrong versions without falling back", async ({
  page,
}) => {
  for (const path of [
    "/components/animated-line-chart/versions/1.0.1/preview",
    "/components/unknown-component/versions/1.0.0/preview",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Component version unavailable" }),
    ).toBeVisible();
    await expect(page.getByTestId("component-identity")).toHaveCount(0);
  }
});

test("plays from elapsed time, completes at the final frame, and restarts", async ({
  page,
}) => {
  await openPreview(page);
  const frame = page.getByTestId("frame-output");
  const stage = page.getByTestId("preview-stage");
  await expect(frame).toHaveText("Frame 0 / 119");
  await stage.evaluate((element) => {
    (
      window as typeof window & { __relayPreviewStage?: Element }
    ).__relayPreviewStage = element;
  });

  await page.getByRole("button", { name: "Play preview" }).click();
  await expect.poll(async () => frame.textContent()).not.toBe("Frame 0 / 119");
  await page.getByRole("button", { name: "Pause preview" }).click();
  const pausedFrame = await frame.textContent();
  await page.waitForTimeout(150);
  await expect(frame).toHaveText(pausedFrame ?? "");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __relayPreviewStage?: Element })
          .__relayPreviewStage ===
        document.querySelector('[data-testid="preview-stage"]'),
    ),
  ).toBe(true);

  await page.getByRole("slider", { name: "Current frame" }).fill("116");
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(frame).toHaveText("Frame 119 / 119", { timeout: 2_000 });
  await expect(
    page.getByRole("button", { name: "Play preview" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(frame).not.toHaveText("Frame 119 / 119");
  await expect(
    page.getByRole("button", { name: "Pause preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause preview" }).click();
});

test("seeks, clamps boundaries, and steps exactly one frame", async ({
  page,
}) => {
  await openPreview(page);
  const scrubber = page.getByRole("slider", { name: "Current frame" });
  await scrubber.fill("45");
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 45 / 119");
  await expect(page.locator("svg[data-draw-progress]")).toHaveAttribute(
    "data-draw-progress",
    "0.500",
  );

  await page.getByRole("button", { name: "Step backward one frame" }).click();
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 44 / 119");
  await page.getByRole("button", { name: "Step forward one frame" }).click();
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 45 / 119");

  await scrubber.fill("0");
  await expect(
    page.getByRole("button", { name: "Step backward one frame" }),
  ).toBeDisabled();
  await scrubber.fill("119");
  await expect(
    page.getByRole("button", { name: "Step forward one frame" }),
  ).toBeDisabled();
});

test("uses exact checkpoint frames", async ({ page }) => {
  await openPreview(page);
  await page.getByRole("button", { name: "half-drawn · 45" }).click();
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 45 / 119");
  await page.getByRole("button", { name: "settled-highlight · 119" }).click();
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 119 / 119");
});

test("fixture switching resets edited input, frame, playback, and errors", async ({
  page,
}) => {
  await openPreview(page);
  const fixture = page.getByLabel("Fixture");
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const scrubber = page.getByRole("slider", { name: "Current frame" });

  await title.fill("Creator-edited audience trend");
  await scrubber.fill("45");
  await title.fill("");
  const inputAlert = page.locator("[role='alert']").filter({
    hasText: "Input needs attention",
  });
  await expect(inputAlert).toContainText("Input needs attention");
  await page.getByRole("button", { name: "Play preview" }).click();

  await fixture.selectOption("empty");
  await expect(page.getByText("No data available")).toBeVisible();
  await expect(title).toHaveValue("No observations yet");
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 0 / 119");
  await expect(
    page.getByRole("button", { name: "Play preview" }),
  ).toBeVisible();
  await expect(inputAlert).toHaveCount(0);
  await expect(
    page.getByText("No component diagnostics captured."),
  ).toBeVisible();

  await fixture.selectOption("channel-growth");
  await expect(title).toHaveValue("Monthly channel growth");
  await expect(page.getByTestId("frame-output")).toHaveText("Frame 0 / 119");
});

test("switches dimensions without changing frame semantics and scales the whole stage", async ({
  page,
}) => {
  await openPreview(page);
  await page.getByRole("slider", { name: "Current frame" }).fill("45");
  await page.getByLabel("Dimensions").selectOption("1280x720");

  await expect(page.getByTestId("frame-output")).toHaveText("Frame 45 / 119");
  await expect(page.locator("svg[data-draw-progress]")).toHaveAttribute(
    "width",
    "1280",
  );
  await expect(page.locator("svg[data-draw-progress]")).toHaveAttribute(
    "height",
    "720",
  );
  const stage = page.getByTestId("preview-stage");
  await expect(stage).toHaveAttribute("data-width", "1280");
  await expect(stage).toHaveAttribute("data-height", "720");

  const stageBox = await stage.boundingBox();
  const viewportBox = await page.getByTestId("preview-surface").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(viewportBox).not.toBeNull();
  expect(stageBox!.width).toBeLessThanOrEqual(viewportBox!.width + 1);
  expect(stageBox!.height).toBeLessThanOrEqual(viewportBox!.height + 1);
  expect(stageBox!.width / stageBox!.height).toBeCloseTo(16 / 9, 2);
});

test("applies valid controls and preserves the last valid preview for invalid edits", async ({
  page,
}) => {
  await openPreview(page);
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Creator-edited audience trend");
  await expect(
    page.getByRole("img", { name: "Creator-edited audience trend" }),
  ).toBeVisible();

  await title.fill("");
  const alert = page.locator("[role='alert']").filter({
    hasText: "Input needs attention",
  });
  await expect(alert).toContainText("title");
  await expect(alert).toContainText("Chart title is required");
  await expect(alert).toContainText("last valid preview");
  await expect(
    page.getByRole("img", { name: "Creator-edited audience trend" }),
  ).toBeVisible();

  await title.fill("Recovered valid title");
  await expect(
    page.getByRole("img", { name: "Recovered valid title" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Labels", exact: true }).fill("[");
  await expect(alert).toContainText("labels");
  await expect(alert).toContainText("Enter valid JSON");

  await title.fill("Must not bypass malformed JSON");
  await expect(alert).toContainText("labels");
  await expect(
    page.getByRole("img", { name: "Recovered valid title" }),
  ).toBeVisible();
});

test("starts a worker draft render, observes success, and downloads the pinned MP4", async ({
  page,
}) => {
  await openPreview(page);
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Pinned creator render");
  const renderResolution = page.getByLabel("Render resolution");
  await expect(renderResolution.locator("option")).toHaveText([
    "720p HD · 1280 × 720",
    "1080p Full HD · 1920 × 1080",
    "1440p QHD · 2560 × 1440",
    "4K UHD · 3840 × 2160",
  ]);
  await renderResolution.selectOption("3840x2160");
  await expect(page.getByText("3840×2160", { exact: true })).toBeVisible();
  const renderQuality = page.getByLabel("Render quality");
  await expect(renderQuality.locator("option")).toHaveText([
    "Master graphics · CRF 1 · 4:4:4",
    "High · CRF 10 · 4:4:4",
    "Compatible · CRF 18 · 4:2:0",
    "Compact · CRF 28 · 4:2:0",
  ]);
  await expect(renderQuality).toHaveValue("master");
  await expect(
    page.getByText("H.264 · Master graphics · CRF 1 · 4:4:4"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Render MP4" }).click();

  const status = page.getByTestId("draft-render-status");
  await expect(status).toContainText("animated-line-chart@1.0.0");
  await expect(status).toContainText("channel-growth");
  await expect(status).toContainText("succeeded", { timeout: 5_000 });
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^relay-draft-.*\.mp4$/);
  expect(await download.createReadStream()).not.toBeNull();
});

test("cancels an active worker draft without exposing a download", async ({
  page,
}) => {
  await openPreview(page);
  await page.getByRole("button", { name: "Render MP4" }).click();
  await page.getByRole("button", { name: "Cancel render" }).click();
  await expect(page.getByTestId("draft-render-status")).toContainText(
    "canceled",
  );
  await expect(page.getByRole("link", { name: "Download MP4" })).toHaveCount(0);
});

test("contains runtime failures and surfaces captured diagnostics", async ({
  page,
}) => {
  await page.goto("/components/runtime-failure-proof/versions/1.0.0/preview");
  await expect(
    page.getByRole("img", { name: "Runtime containment proof" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Step forward one frame" }).click();
  const runtimeAlert = page.getByTestId("preview-surface").getByRole("alert");
  await expect(runtimeAlert).toContainText(
    "Component could not render this frame",
  );
  await expect(runtimeAlert).toContainText(
    "Intentional component runtime failure",
  );
  await expect(page.getByTestId("diagnostics")).toContainText(
    "Component diagnostic before intentional runtime failure",
  );

  await page.getByRole("slider", { name: "Current frame" }).fill("0");
  await expect(runtimeAlert).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Runtime containment proof" }),
  ).toBeVisible();
});
