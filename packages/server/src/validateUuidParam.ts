import type { Request } from "express";
import { z } from "zod";
import { BadRequestError } from "./errors/appError";

const UuidSchema = z.string().uuid();

/**
 * Validate the `:id` route param as a UUID, returning it or throwing a 400.
 * The optional label names the entity in the message ("Invalid chapter id.");
 * omit it for a generic "Invalid id." The label is a closed union, not a bare
 * string, so the set of entity names stays compiler-enforced as it was before
 * this helper was lifted out of `snapshots.routes.ts` (OOSA1).
 *
 * S10: adoption is NOT universal — this helper serves chapters, snapshots and
 * outtakes. `images.routes.ts` is the one holdout, running its own parallel
 * `requireUuidParam` regex middleware with differently-worded copy.
 *
 * S7 (dedup review 2026-07-26): this paragraph used to add that
 * `chapters.routes.ts` "validates nothing", which `c0a5c97` falsified nine
 * minutes after it was written — chapters calls this helper at all four of its
 * `:id` handlers.
 *
 * The images holdout is a DEFERRAL, not an oversight, and stays — but for ONE
 * reason, not two: its `router.use()` form is structurally STRONGER than the
 * per-handler form here (it cannot be forgotten on a new handler).
 *
 * I4 (review 2026-08-16): this paragraph used to add that "the two accepted
 * domains genuinely differ — Zod enforces the UUID version and variant nibbles,
 * while the regex accepts any 32 hex nibbles". That is no longer true in either
 * clause. Declaring `zod: ^3.24.3` in packages/server/package.json (the F-11
 * phantom-dependency fix) changed which copy this file resolves — from the
 * hoisted root zod 4.x to packages/server's own zod 3.x — and zod 3's `.uuid()`
 * is a pure hex-shape check. It now accepts exactly what `UUID_PATTERN`
 * (`images/images.paths.ts`, applied case-insensitively) accepts.
 *
 * Consequences worth knowing before touching this: the widened set is still
 * hex-only in fixed shape, every consumer feeds it to a parameterized Knex
 * query, and the one filesystem-path consumer is gated by images.routes.ts's
 * own regex — so the practical change is that a handful of previously-400
 * requests are now 404s. `__tests__/validateUuidParam.test.ts` pins both the
 * accepted domain and the agreement with `UUID_PATTERN`, so a zod upgrade that
 * re-tightens either one surfaces there instead of in a browser.
 */
type UuidParamLabel = "chapter" | "snapshot" | "outtake" | "project";

export function validateUuidParam(req: Request, label?: UuidParamLabel): string {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new BadRequestError(label ? `Invalid ${label} id.` : "Invalid id.");
  }
  return parsed.data;
}
