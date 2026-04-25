import { test, expect, type APIRequestContext } from "@playwright/test";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // S6 (review 2026-04-25): Date.now() millisecond resolution can collide
  // under Playwright sharding; append crypto.randomUUID() for hard uniqueness.
  const res = await request.post("/api/projects", {
    data: { title: `Save Test ${Date.now()}-${crypto.randomUUID()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as TestProject;
  expect(json.id).toBeTruthy();
  expect(json.slug).toBeTruthy();
  return json;
}

async function deleteProject(request: APIRequestContext, slug: string) {
  const res = await request.delete(`/api/projects/${slug}`);
  expect(res.ok()).toBeTruthy();
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

  test("shows error on save failure and recovers when network returns", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Intercept PATCH requests to chapters to simulate network failure
    await page.route("**/api/chapters/**", (route) => {
      if (route.request().method() === "PATCH") {
        route.abort("connectionrefused");
      } else {
        route.continue();
      }
    });

    // Type content — this will trigger auto-save which will fail
    const testText = `Failure test ${Date.now()}`;
    await editor.click();
    await editor.pressSequentially(testText, { delay: 20 });

    // Wait for the save error to appear (after debounce + retry exhaustion)
    // 4 total attempts (initial + 3 retries) with delays 2s/4s/8s = ~15.7s + 1.5s debounce
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText("Unable to save", { timeout: 30000 });

    // Remove the network interception — allow saves to succeed
    await page.unroute("**/api/chapters/**");

    // Type more to trigger a new save attempt
    await editor.pressSequentially(" recovered", { delay: 20 });

    // The save should now succeed
    await expect(statusRegion).toContainText("Saved", { timeout: 15000 });

    // Verify full content (pre-failure + recovery) persisted by reloading
    await page.reload();
    const editorAfterReload = page.getByRole("textbox");
    await expect(editorAfterReload).toBeVisible();
    await expect(editorAfterReload).toContainText(testText + " recovered", { timeout: 5000 });
  });

  test("content persists across chapter switches (after auto-save)", async ({ page, request }) => {
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
    const chapterItems = page.locator("aside[aria-label='Chapters'] li");
    await chapterItems.nth(1).click();

    // Wait for editor to update (should be empty for new chapter)
    await expect(editor).toBeVisible();

    // Switch back to first chapter
    await chapterItems.nth(0).click();

    // Verify first chapter content is still there
    await expect(editor).toContainText(firstChapterText, { timeout: 5000 });
  });

  test("immediate save on chapter switch preserves unsaved content", async ({ page, request }) => {
    // Add a second chapter
    await request.post(`/api/projects/${project.slug}/chapters`);

    await page.goto(`/projects/${project.slug}`);

    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Type in first chapter — do NOT wait for auto-save debounce to complete
    const unsavedText = `Unsaved switch ${Date.now()}`;
    await editor.click();
    await editor.pressSequentially(unsavedText, { delay: 20 });

    // Immediately switch to second chapter — this should trigger flushSave
    // (bypassing the 1.5s debounce)
    const chapterItems = page.locator("aside[aria-label='Chapters'] li");
    await chapterItems.nth(1).click();

    // Wait for the second chapter to load (editor should now be empty/different)
    // This confirms the flush save and chapter switch both completed
    await expect(editor).toBeVisible();

    // Switch back to first chapter
    await chapterItems.nth(0).click();

    // Verify the content typed before switching was saved
    await expect(editor).toContainText(unsavedText, { timeout: 5000 });
  });
});
