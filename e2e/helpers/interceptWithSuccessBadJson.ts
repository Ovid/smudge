import type { Page } from "@playwright/test";

/**
 * Intercept POST requests matching `urlGlob`, forward to the real server
 * (so the side effect actually lands), then replace the response body
 * with unparseable JSON so the client surfaces its committed-recovery
 * branch. The forwarded response keeps whatever 2xx status the server
 * returned (200 or 201) — the client's possiblyCommitted path triggers on
 * any 2xx BAD_JSON, not just 200, so this preserves the realistic shape
 * of each endpoint's create/restore response.
 *
 * Shared by the three recovery specs:
 *   - chapter-create-recovery.spec.ts  (POST /api/projects/:slug/chapters)
 *   - snapshot-create-recovery.spec.ts (POST /api/chapters/:id/snapshots)
 *   - trash-restore-recovery.spec.ts   (POST /api/chapters/:id/restore)
 *
 * Each spec's recovery GET path is on a different URL (`/api/projects/:slug`),
 * so this glob does not interfere with the follow-up refresh.
 */
export async function interceptWithSuccessBadJson(page: Page, urlGlob: string): Promise<void> {
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
