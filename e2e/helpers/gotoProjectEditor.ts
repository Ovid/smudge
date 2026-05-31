import { expect, type Page } from "@playwright/test";

/**
 * Editor-ready wait budget for e2e navigation.
 *
 * The editor (TipTap/ProseMirror) mounts client-side only after the SPA
 * fetches the project, and under the Vite dev server that backs `make e2e`
 * the first navigation pulling in the heavy editor module graph — or any
 * navigation that triggers a Vite dependency re-optimization + full page
 * reload mid-suite — can take well over Playwright's default 5s expect
 * timeout to compile and mount. That margin is the source of the intermittent
 * "textbox not found" flake. Wait for the editor with a generous timeout
 * (well within the 30s per-test timeout) so a slow cold/recompiled mount no
 * longer fails this shared precondition.
 *
 * Centralized here — alongside the other cross-spec e2e helpers — so every
 * test gets the robust wait rather than re-deriving the default-timeout
 * version (or a one-off shorter override) per spec.
 */
const EDITOR_READY_TIMEOUT = 15_000;

/**
 * Wait for the editor to be mounted and visible, with the generous
 * cold-compile budget. Use after any action that (re)mounts the editor —
 * `page.reload()`, a dashboard→editor click, etc. — where a bare
 * `page.goto` did not happen so `gotoProjectEditor` does not apply.
 */
export async function expectEditorReady(page: Page): Promise<void> {
  await expect(page.getByRole("textbox")).toBeVisible({ timeout: EDITOR_READY_TIMEOUT });
}

/** Navigate to a project's editor and wait for it to be ready. */
export async function gotoProjectEditor(page: Page, slug: string): Promise<void> {
  await page.goto(`/projects/${slug}`);
  await expectEditorReady(page);
}
