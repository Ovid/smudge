import { test, expect, type APIRequestContext } from "@playwright/test";
import { interceptWithSuccessBadJson } from "./helpers/interceptWithSuccessBadJson";
import { gotoProjectEditor } from "./helpers/gotoProjectEditor";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

interface ProjectWithChapters extends TestProject {
  chapters: { id: string; title: string }[];
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // Date.now() resolution can collide under Playwright sharding; append
  // crypto.randomUUID() for hard uniqueness — matches the other recovery
  // specs.
  const res = await request.post("/api/projects", {
    data: {
      title: `Trash Restore Recovery ${Date.now()}-${crypto.randomUUID()}`,
      mode: "fiction",
    },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as TestProject;
  expect(json.id).toBeTruthy();
  expect(json.slug).toBeTruthy();
  return json;
}

async function fetchProject(
  request: APIRequestContext,
  slug: string,
): Promise<ProjectWithChapters> {
  const res = await request.get(`/api/projects/${slug}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ProjectWithChapters;
}

async function softDeleteChapter(request: APIRequestContext, chapterId: string) {
  const res = await request.delete(`/api/chapters/${chapterId}`);
  expect(res.ok()).toBeTruthy();
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

test.describe("Trash restore recovery (4b.3c.3 I4)", () => {
  let project: TestProject;
  let chapterId: string;
  let projectCreated = false;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
    projectCreated = true;
    // Project creation auto-seeds one chapter. Add a second so the
    // project always has at least one active chapter — when all
    // chapters are trashed, the EditorPage stays in its
    // `!project`-style loading state rather than rendering the Sidebar
    // with the Trash button.
    const createRes = await request.post(`/api/projects/${project.slug}/chapters`);
    expect(createRes.ok()).toBeTruthy();
    const full = await fetchProject(request, project.slug);
    expect(full.chapters.length).toBeGreaterThanOrEqual(2);
    // Soft-delete the first chapter so it appears in the trash; the
    // second stays active so the editor mounts.
    chapterId = full.chapters[0]!.id;
    await softDeleteChapter(request, chapterId);
  });

  test.afterEach(async ({ request }) => {
    if (projectCreated) {
      projectCreated = false;
      await deleteProject(request, project.slug);
    }
  });

  test("200 BAD_JSON drops the trash row, fires recovery GET, and surfaces committed banner", async ({
    page,
  }) => {
    // gotoProjectEditor waits for the editor to mount so the page is past
    // its loading state (one chapter remains active after the beforeEach
    // trashing).
    await gotoProjectEditor(page, project.slug);

    // Open the trash view.
    await page.getByRole("button", { name: /^Trash$/ }).click();

    // Scope the trash row to the main content region — the Sidebar
    // also renders listitems with the same "Untitled Chapter" text,
    // so a page-wide locator is ambiguous.
    const trashRegion = page.getByRole("main");
    const trashRow = trashRegion.getByRole("listitem").filter({ hasText: /Untitled/i });
    await expect(trashRow).toBeVisible({ timeout: 10_000 });

    // Intercept POST /api/chapters/:id/restore: forward to the real
    // server so the chapter is genuinely restored (this is what makes
    // the recovery GET observable in the sidebar) — then mangle the
    // response body so the client's JSON parse fails and the
    // committed-banner + recovery-GET path runs. The recovery GET goes
    // to /api/projects/:slug (no /chapters/ segment) and is not matched
    // by this glob.
    await interceptWithSuccessBadJson(page, "**/api/chapters/*/restore");

    // S4 (review 2026-05-27 round 3): observe the recovery GET
    // dispatch explicitly so a broken recovery path fails fast with
    // a clear "request never fired" error instead of timing out on a
    // downstream chapter-count assertion (which would look like flake
    // rather than a regression).
    const recoveryGetPromise = page.waitForRequest(
      (req) =>
        req.method() === "GET" && new URL(req.url()).pathname === `/api/projects/${project.slug}`,
    );

    await trashRow.getByRole("button", { name: /^Restore$/ }).click();

    // Recovery GET fires while the committed banner is rendering.
    await recoveryGetPromise;

    // (a) Committed banner surfaces via the action error banner.
    //     Copy: STRINGS.error.restoreChapterCommitted — "The chapter may
    //     have been restored but the server response was unreadable.
    //     Refresh to confirm."
    const banner = page.getByRole("alert").filter({ hasText: /may have been restored/i });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // (b) Trash row leaves the list (optimistic drop).
    await expect(trashRow).not.toBeVisible({ timeout: 5_000 });

    // (c) Recovery GET refreshes project state — the restored chapter
    //     reappears in the sidebar's chapter list. Setup has one active
    //     chapter + one trashed; after restore, both are active (count 2).
    //     Sidebar shape: <aside aria-label="Chapters"><ul role="list">…</ul></aside>.
    //     The user returns to the editor via the back-to-editor button.
    await page.getByRole("button", { name: /back to editor/i }).click();
    const chapterItems = page.locator("aside[aria-label='Chapters'] li");
    await expect(chapterItems).toHaveCount(2, { timeout: 10_000 });

    // S4 (review 2026-05-27 round 3): banner persists after the
    // recovery refresh lands. Pre-S4 the spec ended on the
    // chapter-count assertion only, so a regression where the
    // refresh accidentally cleared actionError would have passed
    // silently — the banner copy is the user-facing signal that the
    // restore was committed-but-unreadable.
    await expect(banner).toBeVisible();

    // Clean up the route so afterEach's DELETE is not intercepted.
    await page.unroute("**/api/chapters/*/restore");
  });
});
