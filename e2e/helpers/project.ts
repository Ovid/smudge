import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Shared project fixture for the e2e specs.
 *
 * S6 (dedup review 2026-07-26): every spec reimplemented this against only two
 * helpers in e2e/helpers/. That mattered because the fixture is not static: the
 * 2026-04-27 log-and-continue fix to `deleteProject` reached seven of the
 * twelve copies, and the other five kept a bare `await request.delete(...)`
 * with no status check and no try/catch. The direction of travel was wrong too
 * — outtakes.spec.ts, the newest spec, copied the PRE-fix variant, and its
 * comment says it "mirrors images.spec".
 */

export interface TestProject {
  id: string;
  title: string;
  slug: string;
}

export interface TestChapter {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  word_count: number;
}

/**
 * Create a project for a spec to work in. `titlePrefix` names the owning spec
 * so a leaked row is traceable to it.
 *
 * S6 (review 2026-04-25): Date.now() has millisecond resolution and can collide
 * under Playwright sharding; crypto.randomUUID() is appended for hard
 * uniqueness.
 */
export async function createTestProject(
  request: APIRequestContext,
  titlePrefix: string,
): Promise<TestProject> {
  const res = await request.post("/api/projects", {
    data: { title: `${titlePrefix} ${Date.now()}-${crypto.randomUUID()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as TestProject;
  expect(json.id).toBeTruthy();
  expect(json.slug).toBeTruthy();
  return json;
}

/**
 * Delete a project in teardown.
 *
 * S6 (review 2026-04-27, third pass): cleanup must not compete with the test's
 * own assertion. If the DELETE fails (transient blip, server crashed mid-test),
 * log and continue — the test outcome captures the actual failure. A hard
 * `expect()` here would surface a second, less-informative error from afterEach
 * and mask the original failure in the reporter.
 */
export async function deleteProject(request: APIRequestContext, slug: string): Promise<void> {
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

/** The chapter every new project is seeded with. */
export async function getFirstChapter(
  request: APIRequestContext,
  slug: string,
): Promise<TestChapter> {
  const res = await request.get(`/api/projects/${slug}`);
  expect(res.ok()).toBeTruthy();
  const detail = (await res.json()) as { chapters: TestChapter[] };
  const first = detail.chapters[0];
  // Every new project is seeded with one chapter; an empty list means the
  // fixture's own precondition broke, which is worth failing loudly on rather
  // than handing back undefined for the caller to trip over later.
  expect(first).toBeTruthy();
  return first as TestChapter;
}
