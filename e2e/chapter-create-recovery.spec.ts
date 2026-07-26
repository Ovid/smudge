import { test, expect } from "@playwright/test";
import { interceptWithSuccessBadJson } from "./helpers/interceptWithSuccessBadJson";
import { gotoProjectEditor } from "./helpers/gotoProjectEditor";
import { createTestProject, deleteProject, type TestProject } from "./helpers/project";

test.describe("Chapter create recovery (4b.3c.1)", () => {
  // Track creation explicitly so afterEach does not throw on `project.slug`
  // when beforeEach failed before assigning it.
  let project: TestProject;
  let projectCreated = false;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request, "Chapter Create Recovery");
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
    // Navigate and wait for the editor to mount; project creation seeds one chapter.
    await gotoProjectEditor(page, project.slug);

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
    // Forward the POST to the real server so the chapter is created;
    // then replace the response body with unparseable JSON so the
    // client surfaces createChapterResponseUnreadable.
    await interceptWithSuccessBadJson(page, "**/api/projects/*/chapters");

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
