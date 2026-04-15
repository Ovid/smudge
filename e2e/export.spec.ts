import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

interface TestChapter {
  id: string;
  title: string;
}

const TIPTAP_CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Once upon a time in a land far away." }],
    },
  ],
};

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  const res = await request.post("/api/projects", {
    data: { title: `Export Test ${Date.now()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function addChapter(
  request: APIRequestContext,
  slug: string,
): Promise<TestChapter> {
  const res = await request.post(`/api/projects/${slug}/chapters`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function setChapterContent(
  request: APIRequestContext,
  chapterId: string,
  content: object,
) {
  const res = await request.patch(`/api/chapters/${chapterId}`, {
    data: { content },
  });
  expect(res.ok()).toBeTruthy();
}

async function deleteProject(request: APIRequestContext, slug: string) {
  await request.delete(`/api/projects/${slug}`);
}

test.describe("Export E2e Tests", () => {
  let project: TestProject;
  let firstChapter: TestChapter;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
    // The project comes with one default chapter; fetch it from the project detail
    const projectRes = await request.get(`/api/projects/${project.slug}`);
    expect(projectRes.ok()).toBeTruthy();
    const projectDetail = await projectRes.json();
    firstChapter = (projectDetail.chapters as TestChapter[])[0]!;

    // Add content to the first chapter
    await setChapterContent(request, firstChapter.id, TIPTAP_CONTENT);
  });

  test.afterEach(async ({ request }) => {
    await deleteProject(request, project.slug);
  });

  test("exports manuscript as HTML via dialog", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Wait for the editor to be ready
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Open the export dialog
    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.click();

    // Verify dialog title is visible
    await expect(page.getByText("Export Manuscript")).toBeVisible();

    // Verify HTML radio is checked by default
    const htmlRadio = page.getByRole("radio", { name: "HTML" });
    await expect(htmlRadio).toBeChecked();

    // Set up download listener, then click Export
    const downloadPromise = page.waitForEvent("download");
    const dialogExportButton = page.locator("dialog button", { hasText: "Export" }).last();
    await dialogExportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".html");
  });

  test("exports with chapter selection", async ({ page, request }) => {
    // Add a second chapter with content
    const secondChapter = await addChapter(request, project.slug);
    await setChapterContent(request, secondChapter.id, TIPTAP_CONTENT);

    // Reload to pick up the new chapter
    await page.goto(`/projects/${project.slug}`);

    // Wait for the editor to be ready
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Open the export dialog
    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.click();

    await expect(page.getByText("Export Manuscript")).toBeVisible();

    // Click "Select specific chapters..." to expand chapter selection
    await page.getByText("Select specific chapters...").click();

    // The chapter selection area shows checkboxes for each chapter.
    // Both chapters may have the same default title, so use nth() to target the second.
    const chapterCheckboxes = page.getByRole("checkbox", { name: "Untitled Chapter" });
    await expect(chapterCheckboxes).toHaveCount(2);
    await chapterCheckboxes.nth(1).uncheck();

    // Trigger export and verify download happens
    const downloadPromise = page.waitForEvent("download");
    const dialogExportButton = page.locator("dialog button", { hasText: "Export" }).last();
    await dialogExportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBeTruthy();
  });

  test("exports manuscript as Word (.docx) via dialog", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.click();
    await expect(page.getByText("Export Manuscript")).toBeVisible();

    const docxRadio = page.getByRole("radio", { name: "Word (.docx)" });
    await docxRadio.check();

    const downloadPromise = page.waitForEvent("download");
    const dialogExportButton = page.locator("dialog button", { hasText: "Export" }).last();
    await dialogExportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".docx");
  });

  test("exports manuscript as EPUB via dialog", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.click();
    await expect(page.getByText("Export Manuscript")).toBeVisible();

    const epubRadio = page.getByRole("radio", { name: "EPUB" });
    await epubRadio.check();

    const downloadPromise = page.waitForEvent("download");
    const dialogExportButton = page.locator("dialog button", { hasText: "Export" }).last();
    await dialogExportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".epub");
  });

  test("export dialog shows all five format options", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.click();
    await expect(page.getByText("Export Manuscript")).toBeVisible();

    await expect(page.getByRole("radio", { name: "HTML" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Markdown" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Plain Text" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Word (.docx)" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "EPUB" })).toBeVisible();
  });

  test("export dialog is accessible", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Wait for the editor to be ready
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Open the export dialog
    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.click();

    await expect(page.getByText("Export Manuscript")).toBeVisible();

    // Exclude color-contrast: Tailwind v4 uses oklab() color space which aXe
    // cannot parse, producing false-positive contrast failures.
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
