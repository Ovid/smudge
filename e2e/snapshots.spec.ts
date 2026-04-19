import { test, expect, type APIRequestContext } from "@playwright/test";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  const res = await request.post("/api/projects", {
    data: { title: `Snapshot Test ${Date.now()}`, mode: "fiction" },
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

/** Type content into the editor and wait for it to be saved. */
async function typeAndWaitForSave(
  page: import("@playwright/test").Page,
  text: string,
) {
  const editor = page.getByRole("textbox");
  await editor.click();
  await editor.pressSequentially(text, { delay: 20 });
  const statusRegion = page.locator("[role='status'][aria-live='polite']");
  await expect(statusRegion).toContainText("Saved", { timeout: 10000 });
}

/** Open the snapshot panel via the toolbar clock icon. */
async function openSnapshotPanel(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /^Snapshots/ });
  await btn.click();
  await expect(
    page.getByRole("complementary", { name: "Chapter snapshots" }),
  ).toBeVisible();
}

test.describe("Snapshot E2e Tests", () => {
  let project: TestProject;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
  });

  test.afterEach(async ({ request }) => {
    await deleteProject(request, project.slug);
  });

  test("create a snapshot with a label", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Type content and wait for save
    await typeAndWaitForSave(page, "Snapshot label test content");

    // Open snapshot panel
    await openSnapshotPanel(page);

    // Click "Create Snapshot"
    await page.getByRole("button", { name: "Create Snapshot" }).click();

    // Type a label
    const labelInput = page.getByPlaceholder("Optional label");
    await expect(labelInput).toBeVisible();
    await labelInput.fill("My first snapshot");

    // Click "Save"
    await page.getByRole("button", { name: "Save" }).click();

    // Verify snapshot appears in the list with the label
    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("My first snapshot")).toBeVisible({ timeout: 5000 });
  });

  test("create a snapshot without a label", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    await typeAndWaitForSave(page, "Snapshot no-label test content");

    await openSnapshotPanel(page);

    // Click "Create Snapshot"
    await page.getByRole("button", { name: "Create Snapshot" }).click();

    // Leave label empty and click "Save"
    await page.getByRole("button", { name: "Save" }).click();

    // Verify snapshot appears with "Untitled snapshot" label
    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("Untitled snapshot")).toBeVisible({ timeout: 5000 });
  });

  test("view a snapshot shows banner and old content", async ({ page, request }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Type initial content and save
    await typeAndWaitForSave(page, "Original snapshot content");

    // Open panel and create first snapshot
    await openSnapshotPanel(page);
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    const labelInput = page.getByPlaceholder("Optional label");
    await labelInput.fill("version one");
    await page.getByRole("button", { name: "Save" }).click();

    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("version one")).toBeVisible({ timeout: 5000 });

    // Now modify content
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially(" plus new stuff", { delay: 20 });
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText("Saved", { timeout: 10000 });

    // Click "View" on the first snapshot
    await panel.getByRole("button", { name: "View" }).first().click();

    // Verify banner appears
    await expect(page.getByText("Viewing snapshot:")).toBeVisible({ timeout: 5000 });

    // Verify old content is shown (the snapshot content, not the modified content)
    await expect(page.getByText("Original snapshot content")).toBeVisible();
  });

  test("back to editing dismisses the snapshot view", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    await typeAndWaitForSave(page, "Content before snapshot view");

    await openSnapshotPanel(page);
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("Untitled snapshot")).toBeVisible({ timeout: 5000 });

    // View the snapshot
    await panel.getByRole("button", { name: "View" }).first().click();
    await expect(page.getByText("Viewing snapshot:")).toBeVisible({ timeout: 5000 });

    // Click "Back to editing"
    await page.getByRole("button", { name: "Back to editing" }).click();

    // Verify banner disappears
    await expect(page.getByText("Viewing snapshot:")).not.toBeVisible();

    // Verify normal editor is back
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("restore a snapshot reverts content and creates auto-snapshot", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    // Type original content
    await typeAndWaitForSave(page, "Restorable content");

    // Create a snapshot
    await openSnapshotPanel(page);
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    const labelInput = page.getByPlaceholder("Optional label");
    await labelInput.fill("before changes");
    await page.getByRole("button", { name: "Save" }).click();

    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("before changes")).toBeVisible({ timeout: 5000 });

    // Modify content
    await editor.click();
    await page.keyboard.press("Control+A");
    await editor.pressSequentially("Completely different content", { delay: 20 });
    const statusRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(statusRegion).toContainText("Saved", { timeout: 10000 });

    // View the old snapshot
    await panel.getByRole("button", { name: "View" }).first().click();
    await expect(page.getByText("Viewing snapshot:")).toBeVisible({ timeout: 5000 });

    // Click Restore — this opens a confirm dialog
    await page.getByRole("button", { name: "Restore" }).click();

    // Confirm the restoration in the dialog
    const dialog = page.getByRole("alertdialog", { name: "Restore" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Restore" }).click();

    // Wait for content to revert — banner should disappear
    await expect(page.getByText("Viewing snapshot:")).not.toBeVisible({ timeout: 5000 });

    // Check that an auto-snapshot was created (the list should now have 2 items)
    // The auto-snapshot from restore + the original manual one
    await expect(panel.getByText("auto", { exact: true })).toBeVisible({ timeout: 5000 });

    // Editor should now display the restored content (reloaded from server after restore)
    const editorAfter = page.getByRole("textbox");
    await expect(editorAfter).toContainText("Restorable content", { timeout: 5000 });
  });

  test("delete a snapshot removes it from the list", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    await typeAndWaitForSave(page, "Content for deletion test");

    await openSnapshotPanel(page);
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    const labelInput = page.getByPlaceholder("Optional label");
    await labelInput.fill("to be deleted");
    await page.getByRole("button", { name: "Save" }).click();

    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("to be deleted")).toBeVisible({ timeout: 5000 });

    // Click "Delete" on the snapshot
    await panel.getByRole("button", { name: "Delete" }).first().click();

    // Confirm by clicking "Delete" in the inline confirm
    await expect(panel.getByText("Delete this snapshot?")).toBeVisible();
    // The confirm button text is "Delete" (S.deleteConfirmButton)
    await panel.getByRole("button", { name: "Delete" }).first().click();

    // Verify snapshot is removed from the list
    await expect(panel.getByText("to be deleted")).not.toBeVisible({ timeout: 5000 });
    await expect(panel.getByText("No snapshots yet")).toBeVisible();
  });

  test("duplicate snapshot is skipped with message", async ({ page }) => {
    await page.goto(`/projects/${project.slug}`);
    const editor = page.getByRole("textbox");
    await expect(editor).toBeVisible();

    await typeAndWaitForSave(page, "Duplicate snapshot test");

    await openSnapshotPanel(page);

    // Create first snapshot
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel.getByText("Untitled snapshot")).toBeVisible({ timeout: 5000 });

    // Try to create another snapshot without changing content
    await page.getByRole("button", { name: "Create Snapshot" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    // Verify "Content unchanged" message
    await expect(panel.getByText("Content unchanged since last snapshot.")).toBeVisible({
      timeout: 5000,
    });
  });
});
