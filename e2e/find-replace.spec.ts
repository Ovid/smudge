import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

interface TestChapter {
  id: string;
  title: string;
  sort_order: number;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // S6 (review 2026-04-25): Date.now() millisecond resolution can collide
  // under Playwright sharding; append crypto.randomUUID() for hard uniqueness.
  const res = await request.post("/api/projects", {
    data: { title: `FindReplace Test ${Date.now()}-${crypto.randomUUID()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as TestProject;
  expect(json.id).toBeTruthy();
  expect(json.slug).toBeTruthy();
  return json;
}

async function deleteProject(request: APIRequestContext, slug: string) {
  // S6 (review 2026-04-27, third pass): cleanup must not compete with
  // the test's own assertion. See e2e/editor-save.spec.ts for the
  // full rationale.
  try {
    const res = await request.delete(`/api/projects/${slug}`);
    if (!res.ok()) {
      console.warn(`deleteProject(${slug}): cleanup DELETE returned ${res.status()}`);
    }
  } catch (err) {
    console.warn(
      `deleteProject(${slug}): cleanup threw — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Create an additional chapter via API and set its content. */
async function createChapterWithContent(
  request: APIRequestContext,
  projectSlug: string,
  title: string,
  text: string,
): Promise<TestChapter> {
  const createRes = await request.post(`/api/projects/${projectSlug}/chapters`);
  expect(createRes.ok()).toBeTruthy();
  const chapter = (await createRes.json()) as TestChapter;

  const patchRes = await request.patch(`/api/chapters/${chapter.id}`, {
    data: {
      title,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  });
  expect(patchRes.ok()).toBeTruthy();
  return chapter;
}

/** Type content into the editor and wait for it to be saved. */
async function typeAndWaitForSave(page: Page, text: string) {
  const editor = page.getByRole("textbox");
  await editor.click();
  await editor.pressSequentially(text, { delay: 20 });
  const statusRegion = page.locator("[role='status'][aria-live='polite']");
  await expect(statusRegion).toContainText("Saved", { timeout: 10000 });
}

/** Open the find-and-replace panel via the keyboard shortcut (Ctrl+H). */
async function openFindReplaceViaKeyboard(page: Page) {
  await page.keyboard.press("Control+H");
  await expect(page.getByRole("complementary", { name: "Find and replace" })).toBeVisible();
}

/** Open the find-and-replace panel via the toolbar button. */
async function openFindReplaceViaToolbar(page: Page) {
  const btn = page.getByRole("button", { name: /^Find and replace/ });
  await btn.click();
  await expect(page.getByRole("complementary", { name: "Find and replace" })).toBeVisible();
}

/** Fill the search input within the panel. */
async function fillSearch(page: Page, query: string) {
  const panel = page.getByRole("complementary", { name: "Find and replace" });
  const searchInput = panel.getByPlaceholder("Search...");
  await searchInput.fill(query);
  // Debounce is 300ms — give it time to fire and results to render.
  await page.waitForTimeout(500);
}

/** Fill the replace input within the panel. */
async function fillReplacement(page: Page, replacement: string) {
  const panel = page.getByRole("complementary", { name: "Find and replace" });
  const replaceInput = panel.getByPlaceholder("Replace with...");
  await replaceInput.fill(replacement);
}

test.describe("Find-and-Replace E2e Tests", () => {
  // Track creation explicitly so afterEach does not throw on
  // `project.slug` when beforeEach failed before assigning it. An
  // unguarded cleanup would surface a second error from the test
  // runner and mask the original failure.
  let project: TestProject;
  let projectCreated = false;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
    projectCreated = true;
  });

  test.afterEach(async ({ request }) => {
    if (projectCreated) {
      projectCreated = false;
      await deleteProject(request, project.slug);
    }
  });

  test("Ctrl+H opens the find-and-replace panel", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await openFindReplaceViaKeyboard(page);
  });

  test("toolbar magnifying glass opens the find-and-replace panel", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await openFindReplaceViaToolbar(page);
  });

  test("Escape closes the find-and-replace panel", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await openFindReplaceViaKeyboard(page);
    await page.keyboard.press("Escape");

    await expect(page.getByRole("complementary", { name: "Find and replace" })).not.toBeVisible();
  });

  test("search finds matches in a single chapter", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await typeAndWaitForSave(page, "The cat sat on the mat. The cat was happy.");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "cat");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    await expect(panel.getByText(/Found 2 occurrences in 1 chapter/)).toBeVisible({
      timeout: 5000,
    });
  });

  test("search finds matches across multiple chapters", async ({ page, request }) => {
    // Second chapter created via API
    await createChapterWithContent(request, project.slug, "Chapter Two", "zebra zebra");

    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    // Set content on the first (active) chapter via editor
    await typeAndWaitForSave(page, "one zebra here");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "zebra");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    await expect(panel.getByText(/Found 3 occurrences in 2 chapters/)).toBeVisible({
      timeout: 5000,
    });
  });

  test("match case toggle restricts results to exact case", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await typeAndWaitForSave(page, "Hello hello HELLO");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "hello");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    // Without match case → 3 matches
    await expect(panel.getByText(/Found 3 occurrences/)).toBeVisible({ timeout: 5000 });

    // Turn match case on
    await panel.getByRole("button", { name: "Match case" }).click();
    await page.waitForTimeout(500);
    await expect(panel.getByText(/Found 1 occurrence/)).toBeVisible({ timeout: 5000 });
  });

  test("whole word toggle restricts to word-boundary matches", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await typeAndWaitForSave(page, "cat category cats");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "cat");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    // Without whole word → 3 matches
    await expect(panel.getByText(/Found 3 occurrences/)).toBeVisible({ timeout: 5000 });

    // Turn whole word on
    await panel.getByRole("button", { name: "Whole word" }).click();
    await page.waitForTimeout(500);
    await expect(panel.getByText(/Found 1 occurrence/)).toBeVisible({ timeout: 5000 });
  });

  test("regex toggle enables pattern matching", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await typeAndWaitForSave(page, "I like color and colour equally.");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "colou?r");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    // Without regex → 0 matches (literal 'colou?r' doesn't appear)
    await expect(panel.getByText("No matches found")).toBeVisible({ timeout: 5000 });

    // Turn regex on → 2 matches
    await panel.getByRole("button", { name: "Regular expression" }).click();
    await page.waitForTimeout(500);
    await expect(panel.getByText(/Found 2 occurrences/)).toBeVisible({ timeout: 5000 });
  });

  test("shows 'No matches found' when search term is absent", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await typeAndWaitForSave(page, "Some ordinary content here.");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "zzzzznotfoundzzzzz");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    await expect(panel.getByText("No matches found")).toBeVisible({ timeout: 5000 });
  });

  test("Replace All in Manuscript replaces every match and refreshes results", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    await typeAndWaitForSave(page, "foo bar foo baz foo");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "foo");
    await fillReplacement(page, "qux");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    await expect(panel.getByText(/Found 3 occurrences/)).toBeVisible({ timeout: 5000 });

    await panel.getByRole("button", { name: "Replace All in Manuscript" }).click();

    // Confirm the replace in the confirmation dialog
    const dialog = page.getByRole("alertdialog", { name: "Replace across manuscript?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Replace All" }).click();

    // After replacement, results should refresh to "No matches found".
    await expect(panel.getByText("No matches found")).toBeVisible({ timeout: 5000 });

    // Editor content should now reflect the replacement.
    const editor = page.getByRole("textbox", { name: "Chapter content" });
    await expect(editor).toContainText("qux bar qux baz qux", { timeout: 5000 });
    await expect(editor).not.toContainText("foo");
  });

  test("per-match Replace replaces only the clicked occurrence", async ({ page, request }) => {
    // Create a second chapter with content "dog dog" — must remain untouched.
    await createChapterWithContent(request, project.slug, "Chapter Two", "dog dog");

    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    // First chapter content: two "dog" occurrences.
    await typeAndWaitForSave(page, "dog and dog");

    await openFindReplaceViaKeyboard(page);
    await fillSearch(page, "dog");
    await fillReplacement(page, "cat");

    const panel = page.getByRole("complementary", { name: "Find and replace" });
    await expect(panel.getByText(/Found 4 occurrences in 2 chapters/)).toBeVisible({
      timeout: 5000,
    });

    // Click "Replace" on the first match — only that one occurrence should
    // be replaced, leaving the other match in the active chapter and both
    // matches in the other chapter intact (3 total remaining).
    await panel.getByRole("button", { name: "Replace", exact: true }).first().click();

    await expect(panel.getByText(/Found 3 occurrences in 2 chapters/)).toBeVisible({
      timeout: 5000,
    });

    // Active chapter: only the first "dog" became "cat".
    const editor = page.getByRole("textbox", { name: "Chapter content" });
    await expect(editor).toContainText("cat and dog", { timeout: 5000 });
  });
});
