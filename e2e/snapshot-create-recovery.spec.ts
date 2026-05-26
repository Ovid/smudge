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
    data: {
      title: `Snapshot Create Recovery ${Date.now()}-${crypto.randomUUID()}`,
      mode: "fiction",
    },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as TestProject;
  expect(json.id).toBeTruthy();
  expect(json.slug).toBeTruthy();
  return json;
}

async function deleteProject(request: APIRequestContext, slug: string) {
  // Cleanup must not compete with the test's own assertion. If the DELETE
  // fails (transient blip, server crashed mid-test), log and continue —
  // the test outcome captures the actual failure.
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

test.describe("Snapshot create recovery (4b.3c.2 I3)", () => {
  // Track creation explicitly so afterEach does not throw on `project.slug`
  // when beforeEach failed before assigning it.
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

  test("200 BAD_JSON closes form, refetches list, and surfaces committed banner", async ({
    page,
  }) => {
    await page.goto(`/projects/${project.slug}`);

    // Type chapter content and wait for the auto-save so the snapshot
    // has non-empty contents.
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.pressSequentially("Snapshot recovery content", { delay: 20 });
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText("Saved", { timeout: 10_000 });

    // Open the snapshot panel via the toolbar.
    await page.getByRole("button", { name: /^Snapshots/ }).click();
    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel).toBeVisible();

    // Open the create form and type a label.
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    const labelInput = page.getByPlaceholder("Optional label");
    await expect(labelInput).toBeVisible();
    await labelInput.fill("Recovery test");

    // Intercept the snapshot-create POST. Forward to the real server so
    // the snapshot is genuinely created (this is what makes the recovery
    // refetch observable in the list) — then mangle the response body so
    // the client's JSON parse fails and the committed-banner path runs.
    // The list refresh path (GET `/api/chapters/:id/snapshots`) is the
    // same URL family but only POST is mangled here.
    await page.route("**/api/chapters/*/snapshots", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: '{"invalid":"json"', // missing closing brace — body unparseable
        headers: { ...response.headers(), "content-type": "application/json" },
      });
    });

    await page.getByRole("button", { name: "Save" }).click();

    // (a) The committed banner surfaces. snapshot.create's committed copy
    //     is STRINGS.error.possiblyCommitted — "The request may have
    //     completed, but the server response was unreadable. Refresh the
    //     page to see the current state before trying again."
    const banner = page.getByRole("alert").filter({ hasText: /request may have completed/i });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // (b) The create form closes — the label input is no longer rendered.
    await expect(labelInput).not.toBeVisible({ timeout: 5_000 });

    // (c) The post-committed refetch lands and the new snapshot appears
    //     in the panel's list. We need to unroute first so the refetch's
    //     follow-up POSTs (if any) aren't intercepted; the GET that
    //     refreshes the list shares the URL prefix but is method-gated.
    await expect(panel.getByText("Recovery test")).toBeVisible({ timeout: 10_000 });

    // Clean up the route so afterEach's DELETE-project + cascade DELETE
    // of snapshots are not intercepted.
    await page.unroute("**/api/chapters/*/snapshots");
  });
});
