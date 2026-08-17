/**
 * Discriminating `error.code` for "the row was written but the re-read that
 * confirms it came back empty" (F-12, architecture report 2026-08-11).
 *
 * Every repository `insert()` re-reads the row it just wrote rather than
 * echoing its input, so that a future DB-side default cannot silently diverge
 * from the returned shape. Those re-reads all used to fail with a bare `Error`,
 * which `globalErrorHandler` clamps to a generic 500 carrying no code — so the
 * client's scope registry, which discriminates entirely on `error.code`, had
 * nothing to branch on. `projects` already emitted a discriminating
 * `READ_AFTER_CREATE_FAILURE` for the same condition; the other three modules
 * did not.
 *
 * ONE code for every NEW site, because it is one condition — this constant,
 * not a fresh string. `projects` keeps its older `READ_AFTER_CREATE_FAILURE`
 * (noted above) because renaming a code the client already maps buys nothing;
 * it is a grandfathered spelling, not a second option. A module facing this
 * condition imports this constant. Picking a new name instead is what produces
 * a code no client scope maps — the exact failure mode of I1 (agentic review
 * 2026-08-17), where the scope and the server disagreed about a code.
 *
 * Whether it means
 * "possibly committed" is NOT a property of the code — it is a property of the
 * call site, and it is decided per client scope:
 *
 *   - `images` inserts OUTSIDE a transaction (`uploadImage` calls
 *     `store.insertImage` directly), so the INSERT has auto-committed by the
 *     time the re-read runs. The row really is there; a retry mints a
 *     duplicate. `image.upload` lists this code in `committedCodes`.
 *
 *   - `snapshots` and `outtakes` insert INSIDE `store.transaction(...)`, so
 *     the throw rolls the insert back. Nothing is committed and retrying is
 *     both safe and correct. Their scopes deliberately OMIT this code, so the
 *     user gets ordinary retry copy.
 *
 * The architecture report asserted the opposite for outtakes ("the row is
 * committed … a re-capture mints an invisible duplicate"). That was verified
 * false by execution before this code was written: the rollback leaves no row.
 * Adding `committedCodes` there would have told the writer not to retry a
 * capture that genuinely had not been saved.
 *
 * If a future refactor moves an insert into or out of a transaction, the
 * corresponding scope's `committedCodes` membership must move with it.
 */
export const READ_AFTER_INSERT_FAILURE = "READ_AFTER_INSERT_FAILURE";
