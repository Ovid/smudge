import { test, expect, type APIRequestContext } from "@playwright/test";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // Matches the unique-suffix pattern in editor-save.spec.ts: Date.now()
  // millisecond resolution can collide under Playwright sharding, so append
  // crypto.randomUUID() for hard uniqueness.
  const res = await request.post("/api/projects", {
    data: {
      title: `Chapter Create Recovery ${Date.now()}-${crypto.randomUUID()}`,
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
  // fails (transient blip, server crashed mid-test), log and continue — the
  // test outcome captures the actual failure. A hard `expect()` here would
  // surface a second, less-informative error from afterEach and mask the
  // original test failure in the reporter.
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

test.describe("Chapter create recovery (4b.3c.1)", () => {
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

  test("200 BAD_JSON surfaces committed banner and new chapter via recovery GET", async ({
    page,
  }) => {
    await page.goto(`/projects/${project.slug}`);

    // Wait for the editor to mount; project creation seeds one chapter.
    await expect(page.getByRole("textbox")).toBeVisible();

    // Sidebar uses `<aside aria-label="Chapters"><ul role="list">…</ul></aside>`
    // (see Sidebar.tsx). Scope the listitem count to that aside to avoid
    // matching unrelated lists elsewhere in the page chrome.
    const chapterItems = page.locator("aside[aria-label='Chapters'] li");
    await expect(chapterItems).toHaveCount(1);

    // Intercept the chapter-create POST. We must let the request reach the
    // server so the chapter is genuinely created (this is what makes the
    // recovery GET observable in the sidebar) — then mangle the response
    // body so the client's JSON parse fails and the committed-banner +
    // recovery-GET path runs. Using `route.fulfill` without forwarding
    // would short-circuit the server entirely, leaving the chapter
    // uncreated and the recovery GET returning the original 1 chapter.
    //
    // Glob `**/api/projects/*/chapters` matches the POST endpoint
    // (`/api/projects/<slug>/chapters`, see api/client.ts). The recovery
    // GET path is `/api/projects/<slug>` (no `/chapters` suffix) so it
    // is not matched by this glob — recovery proceeds against a real
    // server response.
    await page.route("**/api/projects/*/chapters", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      // Forward the POST to the real server so the chapter is created;
      // then replace the response body with unparseable JSON so the
      // client surfaces createChapterResponseUnreadable.
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: '{"invalid":"json"', // missing closing brace — body unparseable
        headers: { ...response.headers(), "content-type": "application/json" },
      });
    });

    // Click "Add Chapter" (STRINGS.sidebar.addChapter).
    await page.getByRole("button", { name: /add chapter/i }).click();

    // (a) Committed banner surfaces via ActionErrorBanner (role="alert").
    //     Copy: STRINGS.error.createChapterResponseUnreadable —
    //     "The chapter may have been created, but the server response was
    //      unreadable. Refresh to see the current chapter list."
    const banner = page.getByRole("alert").filter({ hasText: /may have been created/i });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // (b) The recovery GET (un-intercepted `/api/projects/<slug>`) refreshes
    //     the project and surfaces the newly-created chapter in the sidebar:
    //     initialCount (1) + 1 = 2.
    await expect(chapterItems).toHaveCount(2, { timeout: 10_000 });

    // Clean up the route so afterEach's DELETE is not intercepted (the
    // glob is narrower than the projects DELETE path, but be explicit).
    await page.unroute("**/api/projects/*/chapters");
  });
});
