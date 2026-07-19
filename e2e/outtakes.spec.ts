import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoProjectEditor } from "./helpers/gotoProjectEditor";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

interface TestChapter {
  id: string;
  title: string;
}

const CHAPTER_TEXT = "The quick brown fox";

function tiptapText(text: string): object {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // S6 (review 2026-04-25): Date.now() millisecond resolution can collide
  // under Playwright sharding; append crypto.randomUUID() for hard uniqueness.
  const res = await request.post("/api/projects", {
    data: { title: `Outtakes Test ${Date.now()}-${crypto.randomUUID()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function getFirstChapter(request: APIRequestContext, slug: string): Promise<TestChapter> {
  const res = await request.get(`/api/projects/${slug}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  return (detail.chapters as TestChapter[])[0]!;
}

async function deleteProject(request: APIRequestContext, slug: string) {
  await request.delete(`/api/projects/${slug}`);
}

test.describe("Outtakes E2e Tests", () => {
  // Track creation explicitly so afterEach skips deleteProject when
  // beforeEach fails before the project is assigned (mirrors images.spec).
  let project: TestProject;
  let projectCreated = false;

  test.beforeEach(async ({ request, page }) => {
    project = await createTestProject(request);
    projectCreated = true;
    // Seed the first chapter with known text so the editor has a selection.
    const chapter = await getFirstChapter(request, project.slug);
    const patch = await request.patch(`/api/chapters/${chapter.id}`, {
      data: { content: tiptapText(CHAPTER_TEXT) },
    });
    expect(patch.ok()).toBeTruthy();
    // Clear localStorage panel state so tests start from a known state.
    await page.goto(`/projects/${project.slug}`);
    await page.evaluate(() => {
      localStorage.removeItem("smudge:ref-panel-open");
      localStorage.removeItem("smudge:ref-panel-width");
    });
  });

  test.afterEach(async ({ request }) => {
    if (projectCreated) {
      projectCreated = false;
      await deleteProject(request, project.slug);
    }
  });

  test("capture, insert, and delete an outtake; panel stays accessible", async ({ page }) => {
    await gotoProjectEditor(page, project.slug);

    const editor = page.getByRole("textbox", { name: "Chapter content" });
    await expect(editor).toContainText(CHAPTER_TEXT);

    // Open the reference panel and switch to the Outtakes tab.
    await page.getByTitle("Toggle reference panel (Ctrl+.)").click();
    await page.getByRole("tab", { name: "Outtakes" }).click();

    // The Outtakes tab content lives in the tabpanel (the panel itself is a
    // plain <div>, deliberately not a nested landmark — see the a11y fix).
    const outtakesPanel = page.getByRole("tabpanel");
    await expect(outtakesPanel).toBeVisible();

    // Empty state before any capture.
    await expect(
      outtakesPanel.getByText("No outtakes yet. Stash cut text here to find it later."),
    ).toBeVisible();

    // Select the chapter text and send it to outtakes.
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Send selection to outtakes" }).click();

    // The outtake appears in the panel (with its captured text and word count)...
    await expect(outtakesPanel.getByText(CHAPTER_TEXT)).toBeVisible({ timeout: 5000 });
    await expect(outtakesPanel.getByText("4 words")).toBeVisible();

    // ...and capture is non-destructive: the editor content is unchanged.
    const occurrencesInEditor = async () =>
      editor.evaluate(
        (el, needle) => (el.textContent ?? "").split(needle).length - 1,
        CHAPTER_TEXT,
      );
    expect(await occurrencesInEditor()).toBe(1);

    // Insert the outtake back into the editor at a collapsed caret (end of doc)
    // so it appends rather than replacing the still-selected text.
    await editor.click();
    await page.keyboard.press("End");
    await outtakesPanel.getByRole("button", { name: "Insert into editor" }).click();

    // The text now appears twice in the editor.
    await expect
      .poll(occurrencesInEditor, { timeout: 5000 })
      .toBeGreaterThanOrEqual(2);

    // Delete the outtake via the confirm dialog.
    await outtakesPanel.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete this outtake?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm" }).click();

    // The card is gone and the empty state returns.
    await expect(outtakesPanel.getByText(CHAPTER_TEXT)).not.toBeVisible();
    await expect(
      outtakesPanel.getByText("No outtakes yet. Stash cut text here to find it later."),
    ).toBeVisible();

    // aXe-core scan of the panel. Exclude color-contrast: Tailwind v4 uses
    // oklab() which aXe cannot parse (mirrors images.spec).
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
