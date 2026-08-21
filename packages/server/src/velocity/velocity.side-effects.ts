import { getVelocityService } from "./velocity.injectable";
import { logger } from "../logger";

/**
 * Fire the post-commit daily-velocity snapshot for a project, best-effort.
 *
 * Every chapter-content write owes this call once its transaction has
 * committed (`chapters.service.updateChapter`, `snapshots.service.restoreSnapshot`,
 * `search.service.replaceInProject`). All three previously open-coded the
 * identical try/catch, which is the shotgun-surgery risk architecture finding
 * F-03 names: a new post-commit obligation had to be added at three sites and
 * nothing forced it.
 *
 * Side effects and failure contract:
 * - Calls `getVelocityService().updateDailySnapshot(projectId)`.
 * - **Never throws.** A velocity failure must not fail a save whose content is
 *   already committed — the writer's text is safe and the velocity row is
 *   derived data that the next save recomputes. The error is logged at
 *   `error` level, not swallowed silently.
 * - Must be called AFTER the transaction commits, never inside it. The reason
 *   is deadlock, not atomicity — the `catch` below means a failure here can
 *   never roll anything back. `updateDailySnapshot` reaches the
 *   non-transaction-scoped `getProjectStore()` and opens its *own*
 *   transaction, and knex's sqlite dialect pins the pool at `{min:1, max:1}`
 *   (`knex/lib/dialects/sqlite3/index.js`, `poolDefaults`). Calling this from
 *   inside an open transaction therefore waits for the one connection the
 *   caller is still holding. `knexfile.ts` sets neither `pool` nor
 *   `acquireConnectionTimeout`, so that wait runs for knex's 60-second default
 *   and the timeout is then swallowed by the `catch` below: a 2xx returned
 *   after a minute-long hang, with a log line as the only trace.
 *   `updateDailySnapshot`'s own doc comment states the same constraint from
 *   the other side.
 *
 * `failureMessage` is a parameter rather than a fixed string because the three
 * call sites have distinct messages ("...after save", "...after restore",
 * "...after replace") that are pinned by existing tests; the message identifies
 * which write path failed, which is the only thing the log line adds over the
 * structured fields. `context` supplies the site's extra log fields (e.g.
 * `chapter_id`, which the project-wide replace has no single value for).
 */
export async function fireDailySnapshot(
  projectId: string,
  failureMessage: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const svc = getVelocityService();
    await svc.updateDailySnapshot(projectId);
  } catch (err: unknown) {
    logger.error({ err, project_id: projectId, ...context }, failureMessage);
  }
}
