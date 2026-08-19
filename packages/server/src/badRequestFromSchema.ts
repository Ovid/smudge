import { BadRequestError } from "./errors/appError";

/**
 * Turn a schema failure into a 400 that names WHICH failure it was.
 *
 * The endpoints that accept a snapshot or outtake label share one schema
 * fragment — `sanitizedLabelBase` (@smudge/shared) — so "the label cap was
 * breached" is ONE rule about ONE producer. This is where that rule lives.
 * The emitted code is a parameter because the rule is shared and the code is
 * not: each endpoint's client scope keys its copy on its own constant.
 *
 * Keyed on Zod's issue SHAPE (`too_big` on the `label` path) rather than on
 * message text, so rewording the schema message cannot silently unmap the
 * code, and a non-string label (an `invalid_type` on the same path) does NOT
 * get "too long" copy.
 *
 * [S2] (agentic review 2026-08-19): this was two byte-identical private copies
 * in `snapshots.routes.ts` and `outtakes.routes.ts`, differing only in the
 * constant emitted. Nothing was wrong with either copy — both were pinned by
 * their own positive and negative route tests. The hazard was drift: any
 * improvement to the predicate (scanning all issues rather than `issues[0]`,
 * distinguishing the pre-sanitize `.max(5000)` breach from the post-sanitize
 * one, adapting to a future Zod issue shape) would land in one file and
 * silently not the other, leaving one endpoint emitting the discriminating
 * code and its sibling falling back to retry-inviting generic copy for the
 * same user action. Placed here rather than in `errors/` to sit beside
 * `validateUuidParam`, which is the same shape — a route-level helper that
 * throws `BadRequestError`, lifted out of `snapshots.routes.ts`, shared with
 * outtakes.
 *
 * KNOWN LIMIT, carried over unchanged from both copies: only `issues[0]` is
 * examined. With `.strict()`, an unrecognized key is pushed ahead of shape
 * issues, so `{ label: <over-cap>, nope: 1 }` reports the unknown key and
 * falls back to the default code. That degrades to generic copy, never to
 * WRONG copy, and no shipped client sends an unknown key. Fixing it means
 * deciding which of several simultaneous issues a single `code` should
 * describe — a real question, deliberately not answered here.
 */
export function badRequestFromSchema(
  // Structural, not `ZodError<T>`: the generic is invariant, so one annotation
  // cannot take errors from two different schemas. This was true when the
  // helper was per-module and is the reason it can now be shared at all.
  issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }>,
  labelTooLongCode: string,
): BadRequestError {
  const issue = issues[0];
  const labelTooLong = issue?.code === "too_big" && issue.path[0] === "label";
  return new BadRequestError(
    issue?.message ?? "Invalid request body.",
    labelTooLong ? labelTooLongCode : undefined,
  );
}
