import type { Page } from "@playwright/test";

/**
 * Intercept POST requests matching `urlGlob`, forward to the real server
 * (so the side effect actually lands), then replace the response body
 * with unparseable JSON so the client surfaces its committed-recovery
 * branch.
 *
 * Shared by the three recovery specs:
 *   - chapter-create-recovery.spec.ts  (POST /api/projects/:slug/chapters)
 *   - snapshot-create-recovery.spec.ts (POST /api/chapters/:id/snapshots)
 *   - trash-restore-recovery.spec.ts   (POST /api/chapters/:id/restore)
 *
 * Each spec's recovery GET path is on a different URL (`/api/projects/:slug`),
 * so this glob does not interfere with the follow-up refresh.
 */
export async function interceptWith200BadJson(page: Page, urlGlob: string): Promise<void> {
  await page.route(urlGlob, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: '{"invalid":"json"', // missing closing brace — unparseable
      headers: { ...response.headers(), "content-type": "application/json" },
    });
  });
}
