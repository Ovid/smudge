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
 * S10: adoption is NOT universal — this is the shared helper for snapshots and
 * outtakes only. `images.routes.ts` runs its own parallel `requireUuidParam`
 * regex middleware with differently-worded copy, and `chapters.routes.ts`
 * validates nothing (a malformed id there falls through to a lookup and 404s
 * where these routes 400). Prefer this helper for new routes; converting the
 * two holdouts is a client-observable contract change, not a drive-by.
 */
type UuidParamLabel = "chapter" | "snapshot" | "outtake" | "project";

export function validateUuidParam(req: Request, label?: UuidParamLabel): string {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new BadRequestError(label ? `Invalid ${label} id.` : "Invalid id.");
  }
  return parsed.data;
}
