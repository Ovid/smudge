import { getVelocityService } from "./velocity.injectable";
import { logger } from "../logger";

/**
 * Fire the post-commit daily-velocity snapshot for a project, best-effort.
 *
 * Five call sites, of two kinds.
 *
 * Three are the chapter-content writes that owe this call once their
 * transaction has committed: `chapters.service.updateChapter`,
 * `snapshots.service.restoreSnapshot`, `search.service.replaceInProject`.
 * Those three are the ones architecture finding F-03 names — each open-coded
 * the identical try/catch, so a new post-commit obligation had to be added at
 * three sites and nothing forced it.
 *
 * Two more are not content writes but change the project's word total the same
 * way: `chapters.service.deleteChapter` and `chapters.service.restoreChapter`.
 * They carried the identical block and were folded in here rather than left as
 * open-coded copies in the very file being de-duplicated.
 *
 * Side effects and failure contract:
 * - Calls `getVelocityService().updateDailySnapshot(projectId)`.
 * - **Never throws.** A velocity failure must not fail a save whose content is
 *   already committed — the writer's text is safe and the velocity row is
 *   derived data that the next save recomputes. The error is logged at
 *   `error` level, not swallowed silently.
 * - Must be called AFTER the transaction commits, never inside it. The reason
 *   is deadlock, not atomicity — the `catch` below means a failure here can
 *   never roll anything back. Everything `updateDailySnapshot` does reaches
 *   the non-transaction-scoped `getProjectStore()`, and the FIRST such reach
 *   is not its own transaction but the plain `findSettingByKey("timezone")`
 *   inside `getTodayDate`, awaited before `store.transaction(...)` is called
 *   at all — so a trace of a 60-second hang that starts at `store.transaction`
 *   is looking at a line that never ran. `velocity.service.ts` states it from
 *   that side. Either acquire starves the same way: `knexfile.ts` sets
 *   `client: "better-sqlite3"`, whose dialect inherits `poolDefaults` from the
 *   sqlite3 dialect it extends (`knex/lib/dialects/better-sqlite3/index.js`,
 *   `class Client_BetterSQLite3 extends Client_SQLite3`), pinning the pool at
 *   `{min:1, max:1}`. Calling this from inside an open transaction therefore
 *   waits for the one connection the caller is still holding. `knexfile.ts`
 *   sets neither `pool` nor `acquireConnectionTimeout`, so that wait runs for
 *   knex's 60-second default and the timeout is then swallowed by the `catch`
 *   below: a 2xx returned after a minute-long hang, with a log line as the
 *   only trace.
 *
 * `failureMessage` is a parameter rather than a fixed string because the call
 * sites do not share one wording: four distinct messages across the five
 * sites, each pinned by an existing test. The message identifies which write
 * path failed, which is the only thing the log line adds over the structured
 * fields.
 *
 * It does not identify all five, though. `deleteChapter` and `restoreChapter`
 * share the generic "Velocity updateDailySnapshot failed (best-effort)", so a
 * log line cannot tell a failed delete from a failed restore — and neither can
 * the two assertions that pin it (`chapters.service.test.ts:212,252` expect
 * the same string). Giving either site its own wording is a one-line change
 * plus the matching assertion, if that distinction is ever wanted.
 *
 * `context` supplies the site's extra log fields: `chapter_id` at four sites,
 * omitted at the fifth, since the project-wide replace has no single value
 * for it.
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
