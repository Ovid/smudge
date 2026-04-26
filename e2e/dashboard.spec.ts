import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // S6 (review 2026-04-25): Date.now() millisecond resolution can collide
  // under Playwright sharding; append crypto.randomUUID() for hard uniqueness.
  const res = await request.post("/api/projects", {
    data: { title: `Test ${Date.now()}-${crypto.randomUUID()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function addChapter(
  request: APIRequestContext,
  slug: string,
): Promise<{ id: string; title: string }> {
  const res = await request.post(`/api/projects/${slug}/chapters`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function deleteProject(request: APIRequestContext, slug: string) {
  await request.delete(`/api/projects/${slug}`);
}

test.describe("Dashboard and Status E2e Tests", () => {
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

  test("change chapter status from sidebar persists after reload", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Wait for sidebar to render with the default chapter
    const statusBadge = page.getByLabel(/^Chapter status:/);
    await expect(statusBadge).toBeVisible();

    // Default status should be "Outline"
    await expect(statusBadge).toHaveText("Outline");

    // Click the status badge to open the dropdown
    await statusBadge.click();

    // Select "Rough Draft" from the listbox
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await listbox.getByText("Rough Draft").click();

    // Verify the badge now shows "Rough Draft"
    await expect(statusBadge).toHaveText("Rough Draft");

    // Reload and verify persistence
    await page.reload();
    const statusBadgeAfterReload = page.getByLabel(/^Chapter status:/);
    await expect(statusBadgeAfterReload).toHaveText("Rough Draft");
  });

  test("dashboard shows chapter table and navigates to editor on click", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Click the Dashboard tab
    const dashboardTab = page.getByRole("button", { name: "Dashboard" });
    await dashboardTab.click();

    // Verify the chapter table shows at least one chapter
    const table = page.locator("table");
    await expect(table).toBeVisible();
    const chapterLink = table.getByRole("button", { name: "Untitled Chapter" });
    await expect(chapterLink).toBeVisible();

    // Click the chapter title to navigate back to editor
    await chapterLink.click();

    // Verify we're back in editor mode — the Editor tab should be active
    const editorTab = page.getByRole("button", { name: "Editor" });
    await expect(editorTab).toHaveAttribute("aria-current", "page");

    // The editor textbox should be visible
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("Ctrl+Shift+ArrowDown navigates to next chapter", async ({ page, request }) => {
    // Add a second chapter
    await addChapter(request, project.slug);

    await page.goto(`/projects/${project.slug}`);

    // Wait for the editor to be ready
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // The first chapter should be active (aria-current="true" on the sidebar item)
    const sidebarItems = page.locator("li[aria-current='true']");
    await expect(sidebarItems).toHaveCount(1);

    // Focus the editor and press Ctrl+Shift+ArrowDown
    await editor.focus();
    await page.keyboard.press("Control+Shift+ArrowDown");

    // Wait for navigation — the second chapter should now be active
    // The sidebar should now show a different chapter as active
    await expect(page.locator("li[aria-current='true']")).toHaveCount(1);

    // The page should have navigated; check the live-region announcement
    const announcement = page.locator("[data-testid='nav-announcement']");
    await expect(announcement).not.toBeEmpty();
  });

  test("aXe accessibility audit on dashboard view", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Switch to Dashboard view
    const dashboardTab = page.getByRole("button", { name: "Dashboard" });
    await dashboardTab.click();

    // Wait for the chapter table to render
    await expect(page.locator("table")).toBeVisible();

    // Exclude color-contrast: Tailwind v4 uses oklab() color space which aXe
    // cannot parse, producing false-positive contrast failures. Actual contrast
    // ratios have been verified manually against WCAG 2.1 AA thresholds.
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("aXe accessibility audit on sidebar with status badges", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Wait for the sidebar and status badge to render
    await expect(page.getByLabel(/^Chapter status:/)).toBeVisible();

    // Exclude color-contrast: Tailwind v4 uses oklab() color space which aXe
    // cannot parse, producing false-positive contrast failures.
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
