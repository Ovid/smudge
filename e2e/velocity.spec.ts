import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  const res = await request.post("/api/projects", {
    data: { title: `Velocity ${Date.now()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function deleteProject(request: APIRequestContext, slug: string) {
  await request.delete(`/api/projects/${slug}`);
}

test.describe("Velocity feature", () => {
  let project: TestProject;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
  });

  test.afterEach(async ({ request }) => {
    await deleteProject(request, project.slug);
  });

  test("shows velocity tab on dashboard", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Write some content to trigger SaveEvent
    await page.locator(".tiptap").click();
    await page.keyboard.type("This is some test content for velocity tracking.");
    await page.waitForTimeout(2000); // Wait for auto-save

    // Navigate to dashboard
    const dashboardTab = page.getByRole("button", { name: /dashboard/i });
    await dashboardTab.click();

    // Verify velocity tab is default
    await expect(page.getByRole("tab", { name: /velocity/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Verify summary strip shows
    await expect(page.getByText(/words today/i)).toBeVisible();
    await expect(page.getByText(/current streak/i)).toBeVisible();
  });

  test("project settings dialog opens from gear icon", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Navigate to dashboard
    const dashboardTab = page.getByRole("button", { name: /dashboard/i });
    await dashboardTab.click();

    // Click gear icon
    await page.getByRole("button", { name: /project settings/i }).click();

    await expect(page.getByLabelText(/word count target/i)).toBeVisible();
    await expect(page.getByLabelText(/deadline/i)).toBeVisible();
  });

  test("app settings shows timezone", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Click settings button in sidebar
    await page.getByRole("button", { name: /settings/i }).click();
    await expect(page.getByLabelText(/timezone/i)).toBeVisible();
  });

  test("velocity tab passes aXe accessibility audit", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);

    // Write some content
    await page.locator(".tiptap").click();
    await page.keyboard.type("Accessibility test content.");
    await page.waitForTimeout(2000);

    // Navigate to dashboard velocity tab
    const dashboardTab = page.getByRole("button", { name: /dashboard/i });
    await dashboardTab.click();

    // Wait for velocity content to load
    await expect(page.getByText(/words today/i)).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
