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
 * The images holdout is a DEFERRAL, not an oversight, and stays: its
 * `router.use()` form is structurally STRONGER than the per-handler form here
 * (it cannot be forgotten on a new handler), and the two accepted domains
 * genuinely differ — Zod enforces the UUID version and variant nibbles, while
 * the regex accepts any 32 hex nibbles. Unifying them is a client-observable
 * contract change, not a drive-by.
 */
type UuidParamLabel = "chapter" | "snapshot" | "outtake" | "project";

export function validateUuidParam(req: Request, label?: UuidParamLabel): string {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new BadRequestError(label ? `Invalid ${label} id.` : "Invalid id.");
  }
  return parsed.data;
}
