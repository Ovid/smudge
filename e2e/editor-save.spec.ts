import { test, expect, type Page } from "@playwright/test";
import { gotoProjectEditor, expectEditorReady } from "./helpers/gotoProjectEditor";
import { createTestProject, deleteProject, type TestProject } from "./helpers/project";

test.describe("Editor save pipeline E2e Tests", () => {
  // Track creation explicitly so afterEach does not throw on
  // `project.slug` when beforeEach failed before assigning it. An
  // unguarded cleanup would surface a second error from the test
  // runner and mask the original failure.
  let project: TestProject;
  let projectCreated = false;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request, "Save Test");
    projectCreated = true;
  });

  test.afterEach(async ({ request }) => {
    if (projectCreated) {
      projectCreated = false;
      await deleteProject(request, project.slug);
    }
  });

  test("typing in editor auto-saves and persists after reload", async ({ page }) => {
    await gotoProjectEditor(page, project.slug);

    const editor = page.getByRole("textbox");

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
    await expectEditorReady(page);
    const editorAfterReload = page.getByRole("textbox");
    await expect(editorAfterReload).toContainText(testText, { timeout: 5000 });
  });

  test("PATCH 404 surfaces chapter-gone copy", async ({ page }) => {
    await gotoProjectEditor(page, project.slug);

    const editor = page.getByRole("textbox");

    // Intercept PATCH /api/chapters/<id> with a 404 envelope. The server
    // contract emits { error: { code, message } }; the chapter.save scope
    // routes byStatus[404] to STRINGS.editor.saveFailedChapterGone. Use
    // route.fulfill (NOT route.abort) so the client sees a real HTTP 404
    // and exercises the byStatus branch — abort would route through the
    // NETWORK path and surface a different copy.
    //
    // Glob `**/api/chapters/*` (single segment) — auto-save PATCHes the
    // chapter root URL `/api/chapters/<id>`; deeper paths
    // (`/api/chapters/<id>/snapshots`, `/api/chapters/<id>/restore`)
    // belong to other features and shouldn't be funneled through this
    // handler. The wider `/**` glob would match those too and require
    // the method gate to do more work.
    //
    // `async` handler with `await` on route.fulfill / route.continue:
    // Playwright's route handler may be sync or async; explicitly
    // awaiting the response settlement ensures the test sees the
    // response delivered before subsequent assertions run. Drift
    // between awaited and non-awaited handlers is a known flake source.
    await page.route("**/api/chapters/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "NOT_FOUND", message: "chapter not found" },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Type to trigger auto-save after the debounce.
    await editor.click();
    await editor.pressSequentially(`Trigger save ${Date.now()}`, { delay: 20 });

    // useProjectEditor short-circuits the retry loop on any 4xx
    // (isClientError branch in handleSave), so the failure surfaces
    // after the first attempt — debounce (1.5s) + a single round-trip,
    // not 4 attempts × backoff. 30s timeout matches the surrounding
    // "shows error on save failure" test for safety on slow CI.
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText(/no longer available/i, { timeout: 30000 });

    // I2 (review 2026-04-26): the 404 must also lock the editor —
    // CLAUDE.md save-pipeline invariant #2 pairs setEditable(false) with
    // editorLockedMessage. Without the lock, the user can keep typing
    // into a chapter the server has already deleted and every debounced
    // auto-save 404s in a loop. Assert both: the lock banner is visible
    // AND the editor's contentEditable is false.
    const lockBanner = page.getByRole("alert").filter({ hasText: /no longer available/i });
    await expect(lockBanner).toBeVisible({ timeout: 5000 });
    await expect(editor).toHaveAttribute("contenteditable", "false");
  });

  // The lock has to be ESCAPABLE, and until these two tests nothing at any
  // level proved it was (agentic review 2026-08-22, OOSI1). The suite had five
  // reducer assertions that `lock` becomes null, two hook tests folding an
  // event list through the reducer by hand, and nineteen component tests that
  // only ever assert the lock APPEARS or that something is REFUSED while it
  // stands. Not one showed a writer getting back to work.
  //
  // That gap matters because the lock is a genuine dead end from inside the
  // editor: every event that clears it dispatches from inside
  // useEditorMutation.run(), and all three run() callers refuse at entry while
  // locked, so no in-editor gesture can reach one. Exactly two exits exist, and
  // one test below pins each. A regression in either strands the writer in a
  // read-only editor — the lock exists to prevent data loss, and losing its
  // exits converts it into the worse failure.
  //
  // Both tests raise the lock the way a real user meets it: an auto-save PATCH
  // returning 404 because the chapter was deleted out from under an open
  // editor. That is the most reachable of the four lock sites and the one the
  // test above already exercises.
  const raiseLockVia404 = async (page: Page) => {
    await page.route("**/api/chapters/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "NOT_FOUND", message: "chapter not found" } }),
        });
      } else {
        await route.continue();
      }
    });
    const editor = page.getByRole("textbox");
    await editor.click();
    await editor.pressSequentially(`Trigger lock ${Date.now()}`, { delay: 20 });
    // Same budget as the sibling test above: 4xx short-circuits the retry
    // loop, so this is debounce (1.5s) + one round-trip, not four backoffs.
    await expect(page.getByRole("alert").filter({ hasText: /no longer available/i })).toBeVisible({
      timeout: 30000,
    });
    await expect(editor).toHaveAttribute("contenteditable", "false");
  };

  test("locked editor recovers via the banner's Refresh button", async ({ page }) => {
    await gotoProjectEditor(page, project.slug);
    await raiseLockVia404(page);

    // Drop the interception BEFORE refreshing, so this models the realistic
    // recovery — a server-side problem that has since cleared — and lets the
    // test prove the writer is genuinely back at work rather than merely
    // looking at a writable box. Note the lock is client state: unrouting does
    // not clear it, which is why the banner is still up when we click.
    await page.unroute("**/api/chapters/*");

    await page.getByRole("button", { name: "Refresh page" }).click();

    // window.location.reload() — a real navigation, so wait for the editor to
    // remount with the cold-compile budget rather than assuming it is instant.
    await expectEditorReady(page);
    const editorAfterRefresh = page.getByRole("textbox");
    await expect(editorAfterRefresh).toHaveAttribute("contenteditable", "true");
    await expect(page.getByRole("alert").filter({ hasText: /no longer available/i })).toHaveCount(0);

    // The assertion that makes this a recovery test rather than a rendering
    // test: typing reaches the server again.
    await editorAfterRefresh.click();
    await editorAfterRefresh.pressSequentially(`Back to work ${Date.now()}`, { delay: 20 });
    await expect(page.locator("[role='status'][aria-live='polite']")).toContainText("Saved", {
      timeout: 10000,
    });
  });

  test("locked editor recovers by leaving the project and returning", async ({ page }) => {
    await gotoProjectEditor(page, project.slug);
    await raiseLockVia404(page);

    // The second exit, and the one that is load-bearing by accident: the logo
    // button is NOT gated on the lock, and `/` and `/projects/:slug` are
    // separate routes, so navigating home unmounts EditorPage and discards the
    // reducer holding the lock. Re-entering mounts a fresh machine at its
    // initial state. Nobody designed this as the escape hatch; it works, users
    // will find it, and without this test a future route restructure (or a
    // lock guard added to the logo button, which would look like a
    // consistency fix) removes it silently.
    //
    // The interception stays ACTIVE here on purpose. This test asks only
    // whether the lock is gone, not whether saving works — the underlying
    // fault is still present, exactly as it would be for a user who navigates
    // away rather than refreshing. Typing here would legitimately re-lock.
    await page.getByRole("button", { name: "Smudge" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });

    await gotoProjectEditor(page, project.slug);
    await expect(page.getByRole("textbox")).toHaveAttribute("contenteditable", "true");
    await expect(page.getByRole("alert").filter({ hasText: /no longer available/i })).toHaveCount(0);
  });

  test("shows error on save failure and recovers when network returns", async ({ page }) => {
    await gotoProjectEditor(page, project.slug);

    const editor = page.getByRole("textbox");

    // Intercept PATCH requests to chapters to simulate network failure.
    // S3 (review 2026-04-26): scope to `**/api/chapters/*` (single
    // segment) — see the rationale in the prior test for why this is
    // tighter than `**/api/chapters/**`.
    // R4 (review 2026-04-26): async + await the route calls — see the
    // rationale in the prior test.
    await page.route("**/api/chapters/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.abort("connectionrefused");
      } else {
        await route.continue();
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
    await page.unroute("**/api/chapters/*");

    // Type more to trigger a new save attempt
    await editor.pressSequentially(" recovered", { delay: 20 });

    // The save should now succeed
    await expect(statusRegion).toContainText("Saved", { timeout: 15000 });

    // Verify full content (pre-failure + recovery) persisted by reloading
    await page.reload();
    await expectEditorReady(page);
    const editorAfterReload = page.getByRole("textbox");
    await expect(editorAfterReload).toContainText(testText + " recovered", { timeout: 5000 });
  });

  test("content persists across chapter switches (after auto-save)", async ({ page, request }) => {
    // Add a second chapter
    await request.post(`/api/projects/${project.slug}/chapters`);

    await gotoProjectEditor(page, project.slug);

    const editor = page.getByRole("textbox");

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

    await gotoProjectEditor(page, project.slug);

    const editor = page.getByRole("textbox");

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
