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

  await expect(page.getByText("No sources added yet")).toBeVisible();
  await page.getByLabel("Source title").fill("National results");
  await page.getByLabel("URL").fill("https://example.com/results");
  await page.getByRole("button", { name: "Add web source" }).click();
  await expect(page.getByText("National results")).toBeVisible();

  await page.getByRole("button", { name: "File" }).click();
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
