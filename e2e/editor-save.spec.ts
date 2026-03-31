import { test, expect, type APIRequestContext } from "@playwright/test";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  const res = await request.post("/api/projects", {
    data: { title: `Save Test ${Date.now()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function deleteProject(request: APIRequestContext, slug: string) {
  await request.delete(`/api/projects/${slug}`);
}

test.describe("Editor save pipeline E2e Tests", () => {
  let project: TestProject;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
  });

  test.afterEach(async ({ request }) => {
    await deleteProject(request, project.slug);
  });

  test("typing in editor auto-saves and persists after reload", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Wait for the editor to be ready
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Type some content
    const testText = `E2e save test ${Date.now()}`;
    await editor.click();
    await editor.pressSequentially(testText, { delay: 20 });

    // Wait for auto-save: debounce (1500ms) + network round-trip buffer
    // Watch for the save status to transition through saving → saved
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText("Saved", { timeout: 10000 });

    // Reload the page
    await page.reload();

    // Wait for the editor to load with persisted content
    const editorAfterReload = page.getByRole("textbox");
    await expect(editorAfterReload).toBeVisible();
    await expect(editorAfterReload).toContainText(testText, { timeout: 5000 });
  });

  test("content persists across chapter switches", async ({ page, request }) => {
    // Add a second chapter
    await request.post(`/api/projects/${project.slug}/chapters`);

    await page.goto(`/projects/${project.slug}`);

    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Type in first chapter
    const firstChapterText = `First chapter ${Date.now()}`;
    await editor.click();
    await editor.pressSequentially(firstChapterText, { delay: 20 });

    // Wait for save
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText("Saved", { timeout: 10000 });

    // Switch to second chapter via sidebar
    const secondChapter = page.locator("nav li").nth(1);
    await secondChapter.click();

    // Wait for editor to update (should be empty for new chapter)
    await expect(editor).toBeVisible();

    // Switch back to first chapter
    const firstChapter = page.locator("nav li").nth(0);
    await firstChapter.click();

    // Verify first chapter content is still there
    await expect(editor).toContainText(firstChapterText, { timeout: 5000 });
  });
});
